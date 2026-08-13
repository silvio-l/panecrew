import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { isMacPlatform } from "../shortcuts/platform";
import {
  matchesShortcut,
  SHORTCUTS,
  terminalTabSelectNumber,
  zoomAction,
} from "../shortcuts/registry";
import { DEFAULT_ZOOM, nextZoomLevel } from "../shortcuts/zoom";
import { routeCompletionKey } from "./completionKeys";
import { attachInlineSuggestion } from "./inlineSuggestion";
import { createChunkDecoder, formatDroppedPaths } from "./ptyIo";
import { usePtyBackend } from "./ptyBackend";
import { loadShellHistory } from "./shellHistory";
import { readTerminalOptions, readTerminalTheme } from "./terminalTheme";
import {
  createDirectoryProbe,
  createSubdirectoryIndex,
  parseOsc7,
} from "./workingDirectory";

// Bindet ein echtes xterm.js-Terminal an eine PTY-Session im Rust-Backend.
// Der IPC-Vertrag (pty_spawn/pty_write/pty_resize/pty_kill, Output als
// Channel<ArrayBuffer> über Tauris Raw-Byte-Transport) ist eingefroren, siehe
// .scratch/panecrew-v0.1/issues/02-ipc-contract.md — hier wird exakt dagegen
// gebaut, nichts erfunden. Der Vertrag schlüsselt seit Ticket 18 über `tabId`
// statt `paneId` (dortiger Addendum-Eintrag): eine Pane kann mehrere Terminal-
// Tabs gleichzeitig haben, jeder mit eigener PTY.
//
// Der gesamte imperative Lebenszyklus (Terminal, FitAddon, Channel, Spawn/Kill,
// Webview-Drag-Drop) liegt in genau einem Effekt; die Komponente darüber bleibt
// reines Chrome. Ticket 03 mountet denselben Hook mehrfach (eine Pane pro
// Mount), Ticket 18 erweitert das auf mehrfach PRO Pane (ein Mount je Terminal-
// Tab) — `tabId` kommt in beiden Fällen stabil vom Grid-Store, nicht mehr aus
// einer eigenen Erzeugung hier (Begründung des StrictMode-Umgangs mit einer
// stabilen Id: siehe `cancelled` weiter unten).

/** Bytes, die wir selbst erzeugen (Shift+Enter). */
const LINE_FEED = 0x0a;

/**
 * Obergrenze für ungeflushten `pendingOutput`, in UTF-16-Codeeinheiten. Ohne
 * sie wächst der String bei einer ausgabestarken Hintergrundaktion (Build,
 * `pnpm install`) in einer minimierten/verdeckten Pane unbegrenzt weiter, bis
 * `requestAnimationFrame` wieder feuert — was in genau diesem Zustand gar
 * nicht passiert.
 */
const MAX_PENDING_OUTPUT_LENGTH = 1_000_000;
/**
 * setTimeout-Fallback neben requestAnimationFrame: rAF pausiert in einem
 * verdeckten/minimierten Fenster vollständig, setTimeout feuert (ggf.
 * gedrosselt) weiter und erzwingt so trotzdem einen Flush.
 */
const FLUSH_FALLBACK_MS = 16;

export interface PtyTerminal {
  /** Container, in den xterm.js sein DOM hängt. */
  containerRef: RefObject<HTMLDivElement | null>;
  copySelection: () => void;
  paste: () => void;
  clear: () => void;
  focus: () => void;
  hasSelection: () => boolean;
  /** `true` vom Mount bis `pty_spawn` sich auflöst (Erfolg ODER Fehler) —
   * der Normalfall ist ein einzelner Frame, spürbar wird es erst, wenn
   * mehrere Panes beim Sitzungs-Restore gleichzeitig spawnen. */
  spawning: boolean;
  /** Schreibt abgelegte Pfade in DIESE Pane, als wären sie getippt worden.
   * Der Aufrufer (Ticket 03: `useWebviewFileDrop.ts` auf Grid-Ebene) hat
   * bereits entschieden, dass der Drop hier landet — die Pane weiß nur noch,
   * wie sie damit umgeht. No-Op vor dem ersten Mount-Effekt-Durchlauf. */
  insertDroppedPaths: (paths: string[]) => void;
}

export function usePtyTerminal(
  tabId: string,
  cwd: string,
  // Cmd/Strg+1..9 wählen einen Terminal-Tab der Pane an (Ticket 18-Nachtrag)
  // — die Tab-Liste selbst lebt im Grid-Store, nicht hier. Als Ref statt
  // Effekt-Abhängigkeit gehalten (s. `selectTabRef` unten): der Haupteffekt
  // hängt nur an [tabId, cwd] und darf bei jedem Tab-Wechsel der Pane nicht
  // neu laufen, sonst stürbe die PTY bei jedem Tab-Öffnen/-Schließen der
  // Geschwister-Tabs neu.
  onSelectTerminalTabByNumber: (number: number) => void,
): PtyTerminal {
  const backend = usePtyBackend();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const selectTabRef = useRef(onSelectTerminalTabByNumber);
  useEffect(() => {
    selectTabRef.current = onSelectTerminalTabByNumber;
  }, [onSelectTerminalTabByNumber]);
  // Die eigentliche Einfüge-Handlung braucht `writeText` (kennt `tabId` UND
  // den `sessionReady`-Schutz) und `suggestion.reset()` — beides lebt nur als
  // lokale Variable im Effekt unten. `insertDroppedPaths` (der öffentliche,
  // stabile Teil der Rückgabe) ruft deshalb nur diesen Ref auf; der Effekt
  // befüllt ihn beim Mount und leert ihn beim Cleanup wieder, damit ein Drop
  // nach dem Unmount ins Leere läuft statt eine tote Closure zu treffen.
  const insertRef = useRef<((paths: string[]) => void) | null>(null);
  // Nur für die Ladeanzeige (2026-08-12) — der eigentliche Zustand, ob
  // schon geschrieben werden darf, bleibt `sessionReady` unten (eine lokale
  // Effekt-Variable, kein Re-Render nötig). Dieses `useState` existiert
  // einzig, damit TerminalPane.tsx den Übergang sehen und den Hinweis wieder
  // ausblenden kann.
  const [spawning, setSpawning] = useState(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setSpawning(true);

    const terminalOptions = readTerminalOptions();
    const terminal = new Terminal({
      allowTransparency: false,
      // Marker und Decorations, mit denen die Inline-Vervollständigung ihren
      // Geistertext ins Zellraster hängt, stehen in xterm 6 noch unter
      // "proposed API" und werfen ohne dieses Flag beim Registrieren.
      allowProposedApi: true,
      cursorBlink: true,
      ...terminalOptions,
      theme: readTerminalTheme(),
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    loadAcceleratedRenderer(terminal);
    // Erst messen, dann spawnen: pty_spawn nimmt cols/rows entgegen, und die
    // Shell druckt ihren ersten Prompt bereits in dieser Breite.
    fitAddon.fit();
    terminal.focus();
    terminalRef.current = terminal;

    // `cancelled` trägt seit Ticket 03 zwei Aufgaben statt einer: `tabId`
    // kommt jetzt stabil vom Grid-Store (Ticket 03/04), nicht mehr frisch pro
    // Effekt-Durchlauf. Reacts StrictMode führt Mount → Cleanup → Mount aber
    // weiter synchron im selben Tick aus, bevor die Mikrotask-Queue leert —
    // ohne Gegenmaßnahme würden zwei echte `pty_spawn`-Aufrufe für DIESELBE
    // `tabId` in Flug gehen. Welcher davon dann im Backend übrig bleibt,
    // entschiede `spawn_and_register`s Insert-Reihenfolge (`pty_commands.rs`)
    // — die richtet sich nach Rust-seitiger Fertigstellung, nicht danach,
    // welcher Aufruf zuerst losgeschickt wurde. Der eigentliche Spawn-Aufruf
    // steht deshalb unten in einem `queueMicrotask` und prüft `cancelled`
    // unmittelbar davor: läuft der Cleanup des ERSTEN Durchlaufs synchron
    // dazwischen (der StrictMode-Fall), setzt er `cancelled`, bevor die
    // Mikrotask feuert — der erste Durchlauf spawnt dann nie wirklich, es
    // gibt also nie zwei Prozesse, zwischen denen das Backend entscheiden
    // müsste. Bei einem echten Unmount (kein zweiter Durchlauf folgt) läuft
    // dieselbe Prüfung genauso: der Spawn unterbleibt ganz.
    //
    // Feuert die Mikrotask hingegen VOR dem Cleanup (normaler Einzel-Mount,
    // oder Cleanup erst nach dem Absetzen des Aufrufs), bleibt `cancelled`
    // die einzige Instanz: sie killt dann im `.then()` unten, sobald der
    // Spawn aufgelöst hat.
    let cancelled = false;
    let sessionReady = false;
    // Zwischen Cleanup und dem Auflösen des Spawns lebt der Channel weiter,
    // das Terminal aber nicht mehr: unter StrictMode ist genau das der normale
    // Ablauf (mount → cleanup → mount), und die noch laufende Shell #1 druckt
    // ihren Prompt in ein bereits disposed Terminal. xterm hat in write() kein
    // eigenes Disposed-Guard, das wäre also ein harter Fehler bei jedem
    // Dev-Mount. Deshalb dieses Flag vor jedem Schreibzugriff.
    let disposed = false;

    const writeBytes = (bytes: Uint8Array) => {
      if (!sessionReady) return;
      backend.write(tabId, bytes);
    };
    const writeText = (text: string) =>
      writeBytes(new TextEncoder().encode(text));
    const syncSize = () => {
      if (!sessionReady) return;
      backend.resize(tabId, terminal.cols, terminal.rows);
    };

    // Genau EIN Decoder pro Pane (Begründung in ptyIo.ts).
    const decodeChunk = createChunkDecoder();
    // Rust bündelt PTY-Reads bereits selbst (größen-/zeitgebunden, siehe
    // pty_manager.rs) — ohne Bündelung hier riefe ein output-lastiger Befehl
    // (verbose Build, `pnpm install`) trotzdem `terminal.write()` oft pro
    // Sekunde auf. decodeChunk muss in Ankunftsreihenfolge pro Nachricht
    // laufen (er trägt den UTF-8-Stream-Zustand über Chunk-Grenzen hinweg) —
    // gebündelt wird nur das bereits dekodierte Textstück, ein Frame lang
    // gesammelt und dann in einem einzigen write() geschrieben.
    let pendingOutput = "";
    let flushRaf = 0;
    let flushTimeout = 0;
    const cancelScheduledFlush = () => {
      if (flushRaf) {
        cancelAnimationFrame(flushRaf);
        flushRaf = 0;
      }
      if (flushTimeout) {
        clearTimeout(flushTimeout);
        flushTimeout = 0;
      }
    };
    const flushOutput = () => {
      cancelScheduledFlush();
      if (disposed || !pendingOutput) return;
      terminal.write(pendingOutput);
      pendingOutput = "";
    };
    // Zwei parallele Fallbacks statt einem: requestAnimationFrame feuert
    // nicht mehr, sobald das Fenster verdeckt/minimiert ist — genau der Fall
    // (Build/`pnpm install` im Hintergrund), in dem die Obergrenze unten
    // sonst gebraucht würde, aber nie zum Zug käme. setTimeout feuert (ggf.
    // gedrosselt) trotzdem weiter.
    const scheduleFlush = () => {
      if (flushRaf || flushTimeout) return;
      flushRaf = requestAnimationFrame(flushOutput);
      flushTimeout = window.setTimeout(flushOutput, FLUSH_FALLBACK_MS);
    };
    const handleOutput = (bytes: ArrayBuffer) => {
      if (disposed) return;
      pendingOutput += decodeChunk(bytes);
      // Obergrenze statt unbegrenztem Wachstum: erzwingt einen sofortigen
      // Flush, falls beide Scheduler oben (verdecktes Fenster + noch nicht
      // abgelaufener setTimeout) gerade nicht greifen.
      if (pendingOutput.length >= MAX_PENDING_OUTPUT_LENGTH) {
        flushOutput();
        return;
      }
      scheduleFlush();
    };

    queueMicrotask(() => {
      if (cancelled) return;
      void backend
        .spawn({
          tabId,
          cwd,
          cols: terminal.cols,
          rows: terminal.rows,
          onOutput: handleOutput,
        })
        .then(() => {
          sessionReady = true;
          if (!disposed) setSpawning(false);
          if (cancelled) {
            backend.kill(tabId);
            return;
          }
          // Zwischen fit() und dem Auflösen des Spawns kann sich der
          // Container schon wieder verändert haben — einmal nachziehen.
          syncSize();
        })
        .catch((error: unknown) => {
          // Kein stiller leerer Kasten: der Fehler landet sichtbar im Puffer.
          if (disposed) return;
          setSpawning(false);
          terminal.write(
            `\r\n\x1b[31mPTY konnte nicht gestartet werden: ${String(error)}\x1b[0m\r\n`,
          );
        });
    });

    // Inline-Vervollständigung: rein additiv auf dem bestehenden I/O-Pfad —
    // sie liest den Terminal-Puffer und schreibt eine angenommene Ergänzung
    // über genau dasselbe pty_write wie eine getippte Taste.
    let shellHistory: readonly string[] = [];
    void loadShellHistory().then((entries) => {
      if (!disposed) shellHistory = entries;
    });

    // Wo die Shell dieser Pane WIRKLICH steht: `cwd` oben ist nur das
    // Startverzeichnis, der Nutzer wechselt es danach selbst. Gemeldet wird es
    // per OSC 7 von PaneCrews eigenem Shell-Wrapper (src-tauri/shell-
    // integration/), einmal pro Prompt — kein Pollen, keine Abfrage pro
    // Tastendruck. Bleibt null bei Shells ohne Wrapper (fish, cmd.exe); dann
    // unterbleiben `cd`-Vorschläge, statt geraten zu werden.
    let liveCwd: string | null = null;
    // Die erste Meldung kommt immer vom lokalen Prompt dieser Pane, noch bevor
    // getippt werden kann. Meldet später ein anderer Rechner (ein `ssh` in der
    // Pane), ist das kein Verzeichnis, das es hier zu prüfen gäbe — dann gilt
    // wieder "unbekannt", statt am letzten lokalen Pfad festzuhalten.
    let localHost: string | null = null;
    // Der Verzeichnisprüfer antwortet erst nach dem Rendern; das Objekt, das
    // dann neu rechnen muss, entsteht eine Zeile später.
    let refreshSuggestion = noop;
    const directories = createDirectoryProbe(() => {
      refreshSuggestion();
    });
    const subdirectories = createSubdirectoryIndex(() => {
      refreshSuggestion();
    });
    const suggestion = attachInlineSuggestion(terminal, {
      write: writeText,
      baseHistory: () => shellHistory,
      cwd: () => liveCwd,
      isDirectory: directories.isDirectory,
      listSubdirectories: subdirectories.list,
      font: terminalOptions,
    });
    refreshSuggestion = suggestion.refresh;

    const disposables = [
      terminal.onData(writeText),
      terminal.parser.registerOscHandler(7, (data) => {
        const reported = parseOsc7(data);
        if (reported) {
          localHost ??= reported.host;
          liveCwd = reported.host === localHost ? reported.path : null;
        }
        return true;
      }),
      // xterm feuert onResize nur bei tatsächlicher Dimensionsänderung — das
      // ist genau die Bedingung des IPC-Vertrags für pty_resize.
      terminal.onResize(syncSize),
    ];

    // Pane-eigener Schriftzoom. Bewusst NICHT über das globale Token
    // --pc-terminal-fontSize auf :root — das würde ab Ticket 03 alle Panes
    // zugleich verstellen, obwohl das Kürzel nur die aktive meint.
    //
    // terminalOptions ist zugleich die Schriftquelle des Geistertextes (per
    // Referenz an attachInlineSuggestion übergeben), deshalb wird hier das
    // Objekt mitgeschrieben und nicht nur terminal.options: eine Zuweisung,
    // beide Ebenen bleiben auf derselben Größe. Ein bereits gezeichneter
    // Geistertext hängt allerdings an seinen inline gesetzten Maßen, bis er
    // neu rendert — daher der refresh().
    const baseFontSize = terminalOptions.fontSize;
    let paneZoom = DEFAULT_ZOOM;
    const applyPaneZoom = (level: number) => {
      paneZoom = level;
      terminalOptions.fontSize = baseFontSize * level;
      terminal.options.fontSize = terminalOptions.fontSize;
      // fit() löst über onResize den bestehenden pty_resize-Pfad aus.
      fitAddon.fit();
      refreshSuggestion();
    };

    terminal.attachCustomKeyEventHandler((event) => {
      // attachCustomKeyEventHandler wird für keydown UND keypress aufgerufen;
      // ohne diese Prüfung würde jeder Tastendruck doppelt behandelt.
      if (event.type !== "keydown") return true;

      // Cmd/Strg +/-/0 ohne Shift: nur die Schrift DIESER Pane. Die
      // Shift-Varianten gehören dem App-weiten Zoom und werden hier nicht
      // angefasst — sie blubbern zum window-Listener in useAppZoom weiter.
      //
      // `zoomAction` ist hier keine Zierde: nicht jedes Kürzel mit
      // `scope: "pane"` ist ein Zoom. Cmd+S (Speichern, gilt nur in der
      // Editorfläche) trägt denselben Scope und muss hier durchfallen, damit
      // es unverändert bei der Shell ankommt, statt die Schrift zu
      // verkleinern.
      const paneShortcut = SHORTCUTS.find(
        (def) =>
          def.scope === "pane" && matchesShortcut(event, def, isMacPlatform()),
      );
      const action = paneShortcut ? zoomAction(paneShortcut) : null;
      if (action !== null) {
        // `return false` hält nur xterm ab; ohne preventDefault zoomte der
        // Webview auf derselben Taste zusätzlich mit.
        event.preventDefault();
        applyPaneZoom(
          action === "reset"
            ? DEFAULT_ZOOM
            : nextZoomLevel(paneZoom, action === "in" ? 1 : -1),
        );
        return false;
      }

      // Cmd/Strg+1..9: Terminal-Tab wählen. Dieselbe Vollständigkeits-Regel
      // wie beim Zoom-Zweig oben — `paneShortcut` kann hier auch ein Treffer
      // sein, der weder Zoom noch Tab-Wahl ist (aktuell nur Cmd+S), und der
      // muss unangetastet zur Shell durchfallen.
      const tabNumber = paneShortcut
        ? terminalTabSelectNumber(paneShortcut)
        : null;
      if (tabNumber !== null) {
        event.preventDefault();
        selectTabRef.current(tabNumber);
        return false;
      }

      // Verzeichnis-Popup und Geistertext: welche Taste ihnen gehört, steht
      // in completionKeys.ts — der Teil ist für sich prüfbar, weil an ihm ein
      // gemeldeter Fehler hing.
      if (routeCompletionKey(event, suggestion)) return false;

      // Shift+Enter: weicher Zeilenumbruch statt Absenden. Ink-basierte CLI-
      // Tools lesen den blanken Linefeed als Zeilenumbruch im Prompt,
      // während \r (Enter) abschickt.
      if (
        event.key === "Enter" &&
        event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        // `return false` hält nur xterms EIGENE Tastaturauswertung ab (die
        // hätte sonst \r geschickt, siehe oben). Ohne dieses preventDefault
        // bleibt Enters Browser-Standardaktion auf xterms versteckter Helper-
        // Textarea aktiv — dort fügt sie einen echten Zeilenumbruch in deren
        // Wert ein, was ein "input"-Event auf demselben Element auslöst. xterm
        // behandelt Eingaben auf diesem Element sonst als Paste und übersetzt
        // enthaltene \n dabei in \r (dieselbe Enter/Paste-Äquivalenz wie in
        // jedem Terminal) — genau das erklärt die gemeldete Unzuverlässigkeit:
        // gelegentlich kam trotz Shift ein echtes Absenden durch. Derselbe
        // Grund wie beim Zoom-Zweig oben (2026-08-12).
        event.preventDefault();
        writeBytes(new Uint8Array([LINE_FEED]));
        return false;
      }

      // Ctrl+Shift+C/V — die verbreiteten Editor-Bindings auf Windows/Linux. Cmd+C/Cmd+V
      // (macOS) und Ctrl+C (SIGINT) bleiben bewusst unangetastet: die
      // Cmd-Varianten bedient xterm.js selbst über die nativen copy/paste-
      // ClipboardEvents seiner Helper-Textarea.
      if (event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey) {
        const key = event.key.toLowerCase();
        if (key === "c") {
          copySelectionFrom(terminal);
          return false;
        }
        if (key === "v") {
          pasteInto(terminal);
          return false;
        }
      }

      return true;
    });

    const resizeObserver = new ResizeObserver(() => {
      // fit() ruft terminal.resize() und löst damit onResize → syncSize aus.
      fitAddon.fit();
    });
    resizeObserver.observe(container);

    // Absolute Pfade gibt es im Webview nur über Tauris eigenes Drag-Drop-
    // Event; ein HTML5-drop-Event liefert File-Objekte ohne Pfad. Das Event
    // selbst ist fensterweit — mit mehreren Panes uneindeutig, welche davon
    // gemeint ist. Die eine Registrierung UND die Positionsprüfung gegen die
    // Pane-Rechtecke liegen deshalb seit Ticket 03 auf Grid-Ebene
    // (`useWebviewFileDrop.ts`); hier steht nur noch, WIE diese eine Pane mit
    // abgelegten Pfaden umgeht, sobald feststeht, dass sie das Ziel ist.
    insertRef.current = (paths: string[]) => {
      const text = formatDroppedPaths(paths);
      // Trailing Space, damit direkt weitergetippt werden kann ("<pfad> was
      // ist hier kaputt?") — der Kernfall für CLI-Agenten.
      if (!text) return;
      // Dieser Weg läuft an onData vorbei, der Ankerpunkt der Vorschläge
      // bekäme den Einwurf also nicht mit.
      suggestion.reset();
      writeText(`${text} `);
    };

    return () => {
      cancelled = true;
      disposed = true;
      cancelScheduledFlush();
      insertRef.current = null;
      resizeObserver.disconnect();
      directories.dispose();
      subdirectories.dispose();
      suggestion.dispose();
      for (const disposable of disposables) disposable.dispose();
      terminalRef.current = null;
      terminal.dispose();
      // pty_kill ist laut Vertrag nicht idempotent — nur killen, wenn der
      // Spawn tatsächlich durchgelaufen ist. Ist er noch unterwegs, übernimmt
      // der then-Zweig oben das Aufräumen (cancelled === true).
      if (sessionReady) backend.kill(tabId);
    };
  }, [tabId, cwd, backend]);

  const copySelection = useCallback(() => {
    const terminal = terminalRef.current;
    if (terminal) copySelectionFrom(terminal);
  }, []);
  const paste = useCallback(() => {
    const terminal = terminalRef.current;
    if (terminal) pasteInto(terminal);
  }, []);
  const clear = useCallback(() => terminalRef.current?.clear(), []);
  const focus = useCallback(() => terminalRef.current?.focus(), []);
  const hasSelection = useCallback(
    () => terminalRef.current?.hasSelection() ?? false,
    [],
  );
  const insertDroppedPaths = useCallback((paths: string[]) => {
    insertRef.current?.(paths);
  }, []);

  return {
    containerRef,
    copySelection,
    paste,
    clear,
    focus,
    hasSelection,
    insertDroppedPaths,
    spawning,
  };
}

// Hardware-beschleunigtes Rendern statt xterms DOM-Default. Der DOM-Renderer
// baut jede Zelle als eigenen Knoten auf; bei bis zu vier Panes, die
// gleichzeitig Ausgabe schreiben (ein Build, ein `pnpm install`, ein Token für
// Token streamender CLI-Agent), ist genau das der Grund, aus dem der Referenz-Editor sein
// integriertes Terminal auf @xterm/addon-webgl umgestellt hat.
//
// Der Aufruf gehört zwingend HINTER terminal.open(): `WebglAddon.activate()`
// liest `terminal.element` und verschiebt sich, solange das fehlt, selbst per
// `onWillOpen` hinter das spätere open() (im ausgelieferten Addon-Code
// nachgelesen, nicht angenommen). Ein WebGL-Fehler flöge dann aus xterms
// Emitter heraus — am try unten vorbei, also ungefangen.
//
// Kein eigenes dispose im Effekt-Cleanup: `terminal.dispose()` räumt seine
// geladenen Addons über den AddonManager mit ab, und die Disposable, die das
// Addon zum Zurücksetzen auf den Standard-Renderer registriert, prüft vorher
// selbst, ob der Terminal-Kern schon entsorgt ist (ebenfalls im Addon-Code
// nachgelesen). Ein zusätzlicher Aufruf hier wäre doppelt, nicht sicherer.
function loadAcceleratedRenderer(terminal: Terminal): void {
  try {
    const webgl = new WebglAddon();
    // Verliert die Grafikkarte den Kontext (GPU-Reset, Treiberwechsel,
    // aufgewachter Rechner), zeichnet das Addon nichts mehr. Sein eigenes
    // dispose() setzt den Standard-Renderer wieder ein: die Pane wird
    // langsamer, bleibt aber sichtbar und bedienbar, statt schwarz zu stehen.
    webgl.onContextLoss(() => {
      webgl.dispose();
    });
    terminal.loadAddon(webgl);
  } catch (error) {
    // Kein WebGL2 (abgeschaltete Beschleunigung, alter Treiber, Headless):
    // xterm rendert dann weiter über das DOM — langsamer, aber vollständig
    // funktionsfähig. Gemeldet wird es trotzdem, sonst ist ein späteres „es
    // ruckelt" nicht mehr von einem echten Fehler zu unterscheiden.
    console.warn("PaneCrew: WebGL-Renderer nicht verfügbar", error);
  }
}

// Kopieren über navigator.clipboard.writeText (kaum eingeschränkt). Das Lesen
// per readText() ist der einzige Pfad mit Plattform-Risiko im WKWebView — es
// betrifft ausschließlich den Kontextmenü-Eintrag, nicht die Tastatur, weil
// natives Cmd+V als ClipboardEvent an xterms Textarea ankommt.
function copySelectionFrom(terminal: Terminal): void {
  const selection = terminal.getSelection();
  if (selection) void navigator.clipboard.writeText(selection).catch(noop);
}

// terminal.paste() statt eigener \x1b[200~-Klammerung: xterm.js setzt die
// Bracketed-Paste-Escapes selbst, aber NUR wenn das laufende Programm den
// Modus DECSET 2004 angefordert hat. Unbedingtes Klammern würde bei allem
// ohne diesen Modus (cat, ein blankes `read`) die Escapes als sichtbaren Text
// "[200~" in den Prozess schreiben. Anforderung erfüllt, korrekter Weg.
function pasteInto(terminal: Terminal): void {
  void navigator.clipboard
    .readText()
    .then((text) => {
      if (text) terminal.paste(text);
    })
    .catch(noop);
}

function noop(): void {
  /* Clipboard-Zugriff darf fehlschlagen, ohne die Pane zu stören. */
}
