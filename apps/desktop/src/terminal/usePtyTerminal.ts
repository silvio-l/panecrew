import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { isMacPlatform } from "../shortcuts/platform";
import {
  CLEAR_TERMINAL_SHORTCUT_ID,
  CLOSE_TERMINAL_TAB_SHORTCUT_ID,
  matchesShortcut,
  NEW_TERMINAL_TAB_SHORTCUT_ID,
  SHORTCUTS,
  terminalTabSelectNumber,
  zoomAction,
} from "../shortcuts/registry";
import { DEFAULT_ZOOM, nextZoomLevel } from "../shortcuts/zoom";
import { routeCompletionKey } from "./completionKeys";
import { attachInlineSuggestion } from "./inlineSuggestion";
import { macLineEditingBytes } from "./macLineEditingKeys";
import { copyTextToClipboard, dedentText } from "./clipboard";
import { createChunkDecoder, formatDroppedPaths } from "./ptyIo";
import { usePtyBackend } from "./ptyBackend";
import { createResizeGate } from "./resizeGate";
import { createSelectionDragTracker } from "./selectionDrag";
import { attachTerminalLinkProvider } from "./terminalLinkProvider";
import { loadShellHistory } from "./shellHistory";
import {
  committedLineCount,
  disposeTerminalActivity,
  reportOutput,
} from "./terminalActivity";
import { readTerminalOptions, readTerminalTheme } from "./terminalTheme";
import { launchLineFor, resolveAdapter } from "./adapters";
import { snippetInit } from "./snippetCommands";
import { systemCommands } from "./systemCommands";
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
/**
 * Verzögerung, mit der eine spaltenändernde Größenanpassung debounced wird
 * (resizeGate.ts) — derselbe Wert wie VS Codes eigene xterm.js-Integration
 * (terminalResizeDebouncer.ts, `DebounceResizeXDelay`), als erprobte
 * Baseline übernommen, kein eigens hergeleiteter Wert.
 */
const COLS_RESIZE_DEBOUNCE_MS = 100;

export interface PtyTerminal {
  /** Container, in den xterm.js sein DOM hängt. */
  containerRef: RefObject<HTMLDivElement | null>;
  /** `true`, wenn wirklich etwas in der Zwischenablage gelandet ist — siehe
   * copySelectionFrom(). */
  copySelection: () => boolean;
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
  // Ticket 35: welcher CLI-Adapter dieser Tab beim Spawn starten soll, `null`
  // für die eingebaute Login-Shell. Wie `cwd` nur beim allerersten Spawn
  // relevant (der Nutzer wechselt das Tool danach nicht mehr innerhalb
  // desselben Tabs) und deshalb genauso Teil der Effekt-Deps unten statt
  // hinter einem Ref versteckt.
  adapterId: string | null,
  // Cmd/Strg+1..9 wählen einen Terminal-Tab der Pane an (Ticket 18-Nachtrag)
  // — die Tab-Liste selbst lebt im Grid-Store, nicht hier. Als Ref statt
  // Effekt-Abhängigkeit gehalten (s. `selectTabRef` unten): der Haupteffekt
  // hängt nur an [tabId, cwd] und darf bei jedem Tab-Wechsel der Pane nicht
  // neu laufen, sonst stürbe die PTY bei jedem Tab-Öffnen/-Schließen der
  // Geschwister-Tabs neu.
  onSelectTerminalTabByNumber: (number: number) => void,
  // Cmd/Strg+W schließt DIESEN Terminal-Tab — genau derselbe Ref-statt-
  // Effekt-Abhängigkeit-Grund wie bei `onSelectTerminalTabByNumber` darüber.
  onCloseTerminalTab: () => void,
  // Cmd/Strg+Shift+T öffnet einen neuen Terminal-Tab in DERSELBEN Pane —
  // derselbe Ref-statt-Effekt-Abhängigkeit-Grund wie bei `onCloseTerminalTab`
  // darüber, dieselbe Quelle wie der „+"-Knopf (`PaneTabsProps.onOpenTerminalTab`).
  onOpenTerminalTab: () => void,
  // Quittiert einen tatsächlich stattgefundenen Kopiervorgang zurück an
  // TerminalPane.tsx' Live-Region. Nur für die Wege nötig, die dort sonst
  // spurlos blieben: Ctrl+Shift+C unten, natives Cmd+C (löst xterms
  // copy-ClipboardEvent auf dessen Helper-Textarea aus, wird dort aber von
  // `handleNativeCopy` abgefangen) und die automatische Kopie einer fertigen
  // Mausauswahl — alle drei über eigene Listener weiter unten. Der
  // Kontextmenü-Weg (`copySelection`) braucht ihn nicht — TerminalPane.tsx
  // ruft ihn dort selbst auf.
  onCopied: () => void,
  // Ob DIESER Tab gerade der sichtbare in seiner Pane ist (PaneGrid.tsx'
  // `isActiveTab`) — entscheidet allein über den WebGL-Kontext (siehe
  // `webglRef`/den Effekt unten), sonst nichts. Ref-statt-Effekt-Abhängigkeit
  // gilt hier NICHT: anders als `onSelectTerminalTabByNumber`/`onCloseTerminalTab`
  // braucht genau dieser Wert einen eigenen, an ihn gebundenen Effekt, um beim
  // Wechsel zu reagieren.
  active: boolean,
): PtyTerminal {
  const backend = usePtyBackend();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  // Der jeweils aktuell geladene WebGL-Kontext dieses Tabs, `null` solange er
  // (Hintergrund-Tab) keinen braucht. Getrennt von `terminalRef`, weil er über
  // die Lebensdauer EINES Mounts mehrfach kommt und geht (jeder Aktiv/Inaktiv-
  // Wechsel), während `terminalRef` für den gesamten Mount stabil bleibt.
  const webglRef = useRef<WebglAddon | null>(null);
  // Von zwei Effekten gelesen/geschrieben (Spawn-Effekt unten UND der
  // Settings-Live-Reload-MutationObserver weiter unten, der eine globale
  // Schriftgrößenänderung mit dem AKTUELLEN Pane-Zoom-Multiplikator
  // kombinieren muss) — deshalb ein Ref statt einer lokalen Variable im
  // Spawn-Effekt, der bei jedem Tab-/Cwd-Wechsel neu läuft.
  const paneZoomRef = useRef(DEFAULT_ZOOM);
  const selectTabRef = useRef(onSelectTerminalTabByNumber);
  useEffect(() => {
    selectTabRef.current = onSelectTerminalTabByNumber;
  }, [onSelectTerminalTabByNumber]);
  const closeTabRef = useRef(onCloseTerminalTab);
  useEffect(() => {
    closeTabRef.current = onCloseTerminalTab;
  }, [onCloseTerminalTab]);
  const openTabRef = useRef(onOpenTerminalTab);
  useEffect(() => {
    openTabRef.current = onOpenTerminalTab;
  }, [onOpenTerminalTab]);
  // Selber Grund wie `selectTabRef`: der Haupteffekt hängt nur an
  // [tabId, cwd, backend] und darf nicht bei jedem Render (der Callback ist
  // in TerminalPane.tsx nicht memoisiert) neu laufen.
  const onCopiedRef = useRef(onCopied);
  useEffect(() => {
    onCopiedRef.current = onCopied;
  }, [onCopied]);
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
    // KEIN Laden hier: der Aktiv/Inaktiv-Effekt weiter unten übernimmt das,
    // auch für den allerersten Mount (er läuft nach diesem Effekt im selben
    // Commit, `terminalRef.current` steht dann längst). Ein Laden an BEIDEN
    // Stellen hieße für jeden von Anfang an aktiven Tab zwei WebGL-Kontexte
    // statt einem — genau der Fehler, den dieses Gating beheben soll.
    // Erst messen, dann spawnen: pty_spawn nimmt cols/rows entgegen, und die
    // Shell druckt ihren ersten Prompt bereits in dieser Breite.
    fitAddon.fit();
    terminal.focus();
    terminalRef.current = terminal;

    // Natives Cmd+C (macOS) löst dieses `copy`-ClipboardEvent auf xterms
    // versteckter Helper-Textarea aus. Früher lief es unangetastet durch
    // xterms eigene ClipboardEvent-Behandlung — genau das ließ mehrzeilige
    // Cmd+C-Kopien OHNE das Dedent aus copySelectionFrom() in der
    // Zwischenablage landen, selbst wenn eine vorherige Mausauswahl (die über
    // `mouseup` dedentet) für dieselbe Selektion schon die bereinigte Version
    // geschrieben hatte — Cmd+C dahinter überschrieb sie wieder mit der
    // undedenteten. `preventDefault()` unterbindet xterms eigenes Schreiben,
    // `copySelectionFrom()` übernimmt komplett — dieselbe Funktion wie beim
    // Mausauswahl- und Ctrl+Shift+C-Pfad, damit alle drei Copy-Wege
    // garantiert dasselbe Ergebnis liefern. `hasSelection()` filtert ein
    // `copy` ohne Markierung heraus (System-Standardaktion feuert das Event
    // trotzdem, kopiert dabei aber nichts).
    const handleNativeCopy = (event: ClipboardEvent) => {
      if (!terminal.hasSelection()) return;
      event.preventDefault();
      if (copySelectionFrom(terminal)) onCopiedRef.current();
    };
    terminal.textarea?.addEventListener("copy", handleNativeCopy);

    // "Select to Copy": eine fertige Mausauswahl landet ohne weiteres Zutun in
    // der Zwischenablage (Nutzer-Wunsch 2026-08-13) — dieselbe Konvention wie
    // bei den gängigen macOS- und Linux-Terminal-Emulatoren. An `mouseup`
    // gehängt, nicht an `terminal.onSelectionChange`: Letzteres feuert bei
    // JEDER Zwischenposition während des Ziehens, ein Listener dort schriebe
    // die Zwischenablage dutzende Male pro Sekunde. xterms eigene
    // Auswahlgesten (Ziehen, Doppel-/Dreifachklick) enden alle in genau einem
    // `mouseup` — die Auswahl steht zu diesem Zeitpunkt bereits fest.
    //
    // Der Listener selbst hängt an `document`, nicht an `container` (Bugfix
    // .scratch/panecrew-v0.1-spec/issues/31): ein Drag, der über den
    // oberen/unteren Rand der Pane hinausgezogen wird, feuert `mouseup` am
    // Element, über dem der Zeiger beim Loslassen steht — nicht an dem, auf
    // dem der Drag begann. xterm.js selbst hält die Selektion in diesem Fall
    // trotzdem korrekt fest (`hasSelection()`), nur ein reiner
    // Container-Listener verpasste das Ereignis: kein Toast, keine Kopie,
    // obwohl eine gültige Markierung dastand. `selectionDrag` filtert das
    // dokumentweite Ereignis auf „diese Pane" zurück (Begründung dort) — sonst
    // kopierte jede Pane mit noch stehender alter Selektion bei jedem
    // beliebigen Klick irgendwo sonst in der App erneut.
    const selectionDrag = createSelectionDragTracker();
    const handleSelectionMouseDown = () => selectionDrag.onMouseDown();
    const handleSelectionMouseUp = () => {
      selectionDrag.onMouseUp(() => {
        if (copySelectionFrom(terminal)) onCopiedRef.current();
      });
    };
    container.addEventListener("mousedown", handleSelectionMouseDown);
    document.addEventListener("mouseup", handleSelectionMouseUp);

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
      const text = pendingOutput;
      pendingOutput = "";
      // Line delta for the activity signal (terminalActivity.ts) — measured
      // BEFORE the actual write(), evaluated only in the callback: xterm
      // parses asynchronously, per its own docs the buffer only reflects the
      // written text once write() completes (@xterm/xterm.d.ts, `write()`
      // comment).
      //
      // reportOutput() is called unconditionally, even when nothing was
      // committed (null/0 delta) — a flush that only redrew the spinner or
      // status line still proves the process is alive, which the "awaiting
      // attention" idle timer needs to know about (terminalActivity.ts
      // header comment: gating liveness on line advances alone let that
      // timer expire mid-turn during a pure "thinking" phase).
      const linesBefore = committedLineCount(terminal);
      terminal.write(text, () => {
        if (disposed) return;
        const linesAfter = committedLineCount(terminal);
        const linesAdvanced =
          linesBefore !== null && linesAfter !== null ? linesAfter - linesBefore : 0;
        reportOutput(tabId, linesAdvanced);
      });
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
          // Tippt den gewählten Adapter-Befehl in die frisch gestartete
          // Login-Shell, als hätte der Nutzer ihn selbst eingetippt und
          // Enter gedrückt (adapters.ts' Kopfkommentar: PATH-Auflösung über
          // die Shell-rc-Dateien statt eigenem exec). `null`/eine veraltete,
          // nicht mehr in ADAPTERS geführte Id resolven beide gleich zur
          // eingebauten Shell — dann bleibt dieser Aufruf ein No-Op.
          const adapter = resolveAdapter(adapterId);
          if (adapter) writeText(launchLineFor(adapter));
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
    // Ticket 01 (snippet-trigger-system): nur die feste `SYSTEM_COMMANDS`-
    // Liste — echte Projekt-/User-Snippets aus `.panecrew/snippets/` bzw.
    // `app_data_dir()/snippets/` kommen erst mit Ticket 02 dazu.
    const runSnippetCommand = (trigger: string) => {
      if (trigger !== "init") return;
      void snippetInit(liveCwd ?? cwd).catch((error: unknown) => {
        if (disposed) return;
        terminal.write(
          `\r\n\x1b[31mInit fehlgeschlagen: ${String(error)}\x1b[0m\r\n`,
        );
      });
    };
    const suggestion = attachInlineSuggestion(terminal, {
      write: writeText,
      baseHistory: () => shellHistory,
      cwd: () => liveCwd,
      isDirectory: directories.isDirectory,
      listSubdirectories: subdirectories.list,
      listSnippetCandidates: systemCommands,
      runSnippetCommand,
      font: terminalOptions,
    });
    refreshSuggestion = suggestion.refresh;

    // Entscheidet, ob eine vorgeschlagene Größe sofort reflowen darf oder
    // (Spaltenänderung, genug Scrollback) erst debounced wird — Begründung
    // und Korruptions-Mechanik in resizeGate.ts. Beide bisherigen fit()-
    // Aufrufer (Pane-Zoom, ResizeObserver unten) laufen jetzt hier durch,
    // damit Flush-vor-Reflow und das Debouncing an genau einer Stelle stehen.
    const resizeGate = createResizeGate(
      (target) => {
        flushOutput();
        terminal.resize(target.cols, target.rows);
        refreshSuggestion();
      },
      {
        schedule: (run) => {
          const id = window.setTimeout(run, COLS_RESIZE_DEBOUNCE_MS);
          return () => window.clearTimeout(id);
        },
      },
      {
        getCurrentCols: () => terminal.cols,
        bufferLength: () => terminal.buffer.active.length,
      },
    );

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
      // Cmd/Ctrl-klickbare URLs und absolute Pfade im Terminal-Output
      // (.scratch/terminal-links-and-reveal/), siehe terminalLinkProvider.ts.
      attachTerminalLinkProvider(terminal),
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
    paneZoomRef.current = DEFAULT_ZOOM;
    const applyPaneZoom = (level: number) => {
      paneZoomRef.current = level;
      terminalOptions.fontSize = baseFontSize * level;
      terminal.options.fontSize = terminalOptions.fontSize;
      // proposeDimensions() statt fitAddon.fit(): nur MESSEN, das eigentliche
      // Anwenden (inkl. Flush-vor-Reflow) übernimmt resizeGate — dieselbe
      // Stelle wie beim ResizeObserver unten, keine zweite Kopie der Fix-Logik
      // aus ptyResizeFlush.test.ts.
      const proposed = fitAddon.proposeDimensions();
      if (proposed) resizeGate.request(proposed);
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
            : nextZoomLevel(paneZoomRef.current, action === "in" ? 1 : -1),
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

      // Cmd/Strg+W: diesen Terminal-Tab schließen (rückfragegesichert, s.
      // registry.ts' Kommentar an CLOSE_TERMINAL_TAB_SHORTCUT_ID).
      if (paneShortcut?.id === CLOSE_TERMINAL_TAB_SHORTCUT_ID) {
        event.preventDefault();
        closeTabRef.current();
        return false;
      }

      // Cmd/Strg+Shift+T: neuen Terminal-Tab in dieser Pane öffnen.
      if (paneShortcut?.id === NEW_TERMINAL_TAB_SHORTCUT_ID) {
        event.preventDefault();
        openTabRef.current();
        return false;
      }

      // Cmd/Strg+K: Scrollback DIESES Terminals leeren (Referenz-Editor-
      // Konvention). Kein Ref-Umweg nötig wie bei den beiden Aktionen oben —
      // `terminalRef` ist in dieser Closure ohnehin schon in Reichweite, und
      // anders als `onCloseTerminalTab`/`onOpenTerminalTab` ist "leeren" keine
      // von außen hereingereichte Aktion, sondern wirkt rein auf die
      // xterm-Instanz dieses Hooks selbst.
      if (paneShortcut?.id === CLEAR_TERMINAL_SHORTCUT_ID) {
        event.preventDefault();
        terminalRef.current?.clear();
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
      // (macOS) und Ctrl+C (SIGINT) bleiben hier bewusst unangetastet: Cmd+V
      // läuft weiter über xterms eigenes paste-ClipboardEvent, und Cmd+C läuft
      // zwar ebenfalls über xterms copy-ClipboardEvent auf der Helper-Textarea,
      // aber `handleNativeCopy` oben hakt sich dort ein und ersetzt den Inhalt
      // durch dasselbe `copySelectionFrom()` wie hier.
      if (event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey) {
        const key = event.key.toLowerCase();
        if (key === "c") {
          if (copySelectionFrom(terminal)) onCopiedRef.current();
          return false;
        }
        if (key === "v") {
          pasteInto(terminal);
          return false;
        }
      }

      // Cmd+←/→/Backspace: nur macOS. Unter Windows/Linux ist Ctrl+←/→
      // bereits die (von xterm.js selbst bediente) Wortsprung-Konvention,
      // keine Zeilenanfang/-ende-Bindung — die Politik in
      // macLineEditingKeys.ts würde dort ohnehin nie ohne Cmd greifen, die
      // Plattformprüfung hier ist also zusätzliche Klarheit, keine Pflicht.
      if (isMacPlatform()) {
        const bytes = macLineEditingBytes(event);
        if (bytes) {
          event.preventDefault();
          writeBytes(bytes);
          return false;
        }
      }

      return true;
    });

    const resizeObserver = new ResizeObserver(() => {
      // Ein Fenster-/Pane-Drag löst diesen Callback Dutzende Male in
      // schneller Folge aus, nicht einmal — resizeGate entscheidet, ob
      // (Zeilenänderung, kleiner Puffer) sofort reflowt wird oder
      // (Spaltenänderung, genug Scrollback) erst nach Ende der Geste, damit
      // nicht jede Zwischengröße ihr eigenes Korruptions-Zeitfenster gegen
      // das asynchrone pty_resize aufmacht (resizeGate.ts).
      const proposed = fitAddon.proposeDimensions();
      if (proposed) resizeGate.request(proposed);
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
      // Ohne dieses focus() bleibt der DOM-Fokus da stehen, wo der Drag
      // begann (Explorer-Zeile bzw. gar nirgends bei einem Finder-Drop) —
      // weitertippen ("<pfad> was ist hier kaputt?") liefe ins Leere.
      terminal.focus();
    };

    return () => {
      cancelled = true;
      disposed = true;
      disposeTerminalActivity(tabId);
      cancelScheduledFlush();
      resizeGate.cancel();
      insertRef.current = null;
      terminal.textarea?.removeEventListener("copy", handleNativeCopy);
      container.removeEventListener("mousedown", handleSelectionMouseDown);
      document.removeEventListener("mouseup", handleSelectionMouseUp);
      resizeObserver.disconnect();
      directories.dispose();
      subdirectories.dispose();
      suggestion.dispose();
      for (const disposable of disposables) disposable.dispose();
      terminalRef.current = null;
      // `terminal.dispose()` gleich darunter räumt ein noch geladenes Addon
      // über seinen eigenen AddonManager mit ab (derselbe Mechanismus wie im
      // Kopfkommentar von `loadAcceleratedRenderer` beschrieben) — dieses Feld
      // hier nur, damit kein Aufrufer über einen jetzt toten Kontext stolpert.
      webglRef.current = null;
      terminal.dispose();
      // pty_kill ist laut Vertrag nicht idempotent — nur killen, wenn der
      // Spawn tatsächlich durchgelaufen ist. Ist er noch unterwegs, übernimmt
      // der then-Zweig oben das Aufräumen (cancelled === true).
      if (sessionReady) backend.kill(tabId);
    };
  }, [tabId, cwd, adapterId, backend]);

  // Hält höchstens einen lebenden WebGL-Kontext pro PANE statt einen pro
  // jemals geöffnetem TAB: `PaneGrid.tsx` mountet jeden Terminal-Tab dauerhaft
  // weiter (nur `visibility: hidden`, s. dortiger Kommentar), und ohne dieses
  // Gating lud der Haupteffekt oben für JEDEN dieser Hintergrund-Tabs
  // bedingungslos einen eigenen Kontext — bei mehreren Fenstern/Panes mit
  // mehreren Tabs genug, um WKWebViews Obergrenze gleichzeitiger WebGL-
  // Kontexte zu reißen. Beobachtetes Bild dabei: kein sauberer Kontextverlust
  // (der bestehende `onContextLoss`-Fallback griff nicht), sondern eine Pane,
  // die fast nichts mehr zeichnete, obwohl xterms eigener Textpuffer nachweis-
  // lich vollständig blieb (Kopieren aus der Pane lieferte den kompletten
  // Text) — ein GPU-Ressourcenproblem, kein Puffer-/Reflow-Bug.
  useEffect(() => {
    const terminal = terminalRef.current;
    // Terminal noch nicht gemountet (sollte hier nie eintreten, s. Kommentar
    // im Haupteffekt oben — beide laufen im selben Commit, dieser danach):
    // still bleiben statt gegen einen nicht existenten Kern zu laden.
    if (!terminal) return;
    if (active && !webglRef.current) {
      webglRef.current = loadAcceleratedRenderer(terminal, () => {
        webglRef.current = null;
      });
    } else if (!active && webglRef.current) {
      // Genau der vom bestehenden `onContextLoss`-Handler dokumentierte Weg
      // zurück zum Standard-Renderer — hier nur freiwillig statt erzwungen.
      webglRef.current.dispose();
      webglRef.current = null;
    }
  }, [active]);

  // Ticket 05 (Settings-System, Live-Reload): ein Theme- ODER
  // Schriftgrößen-Wechsel setzt nur CSS-Custom-Properties neu — eine bereits
  // laufende xterm-Instanz hat `ITheme`/Font aber oben nur EINMAL, bei
  // Konstruktion, gelesen und würde ohne dies auf dem alten Stand hängen
  // bleiben, obwohl das restliche Chrome längst umgeschaltet hat. Eigener,
  // von der konkreten Änderungsquelle entkoppelter Effekt (MutationObserver
  // statt eines `settings:changed`-Listeners): funktioniert unabhängig
  // davon, WAS `data-theme`/`style` gerade gesetzt hat, und bleibt über den
  // Wechsel der Terminal-Instanz im Effekt oben hinweg gültig (deshalb kein
  // `terminal`-Closure-Zugriff, sondern `terminalRef.current` erst zur
  // Feuerzeit gelesen). `style` beobachtet `applyTerminalSettings.ts`s
  // `setProperty("--pc-terminal-fontSize", …)` auf `:root` — der globale
  // Default wird mit dem AKTUELLEN Pane-Zoom multipliziert, damit ein aktiver
  // Cmd+/--Zoom durch eine Settings-Änderung nicht verloren geht.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const terminal = terminalRef.current;
      if (!terminal) return;
      terminal.options.theme = readTerminalTheme();
      const options = readTerminalOptions();
      terminal.options.fontFamily = options.fontFamily;
      terminal.options.fontSize = options.fontSize * paneZoomRef.current;
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "style"],
    });
    return () => observer.disconnect();
  }, []);

  const copySelection = useCallback(() => {
    const terminal = terminalRef.current;
    return terminal ? copySelectionFrom(terminal) : false;
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
//
// Gibt das geladene Addon zurück (oder `null` bei Fehlschlag), statt es nur
// zu laden: der Aufrufer hält es in `webglRef`, um es beim Inaktiv-Werden des
// Tabs wieder gezielt freigeben zu können (s. den Aktiv/Inaktiv-Effekt oben).
// `onContextLoss` läuft zusätzlich zum Addon-eigenen Reset auf den Standard-
// Renderer, damit auch ein SPONTANER Kontextverlust (GPU-Reset, nicht der
// eigene Inaktiv-Wechsel) `webglRef` konsistent auf `null` zurücksetzt — sonst
// hielte der Aktiv/Inaktiv-Effekt einen bereits toten Kontext für lebendig und
// lüde nie neu nach.
function loadAcceleratedRenderer(
  terminal: Terminal,
  onContextLoss: () => void,
): WebglAddon | null {
  try {
    const webgl = new WebglAddon();
    // Verliert die Grafikkarte den Kontext (GPU-Reset, Treiberwechsel,
    // aufgewachter Rechner), zeichnet das Addon nichts mehr. Sein eigenes
    // dispose() setzt den Standard-Renderer wieder ein: die Pane wird
    // langsamer, bleibt aber sichtbar und bedienbar, statt schwarz zu stehen.
    webgl.onContextLoss(() => {
      webgl.dispose();
      onContextLoss();
    });
    terminal.loadAddon(webgl);
    return webgl;
  } catch (error) {
    // Kein WebGL2 (abgeschaltete Beschleunigung, alter Treiber, Headless):
    // xterm rendert dann weiter über das DOM — langsamer, aber vollständig
    // funktionsfähig. Gemeldet wird es trotzdem, sonst ist ein späteres „es
    // ruckelt" nicht mehr von einem echten Fehler zu unterscheiden.
    console.warn("PaneCrew: WebGL-Renderer nicht verfügbar", error);
    return null;
  }
}

// Rückgabewert berichtet den Aufrufern (Mausauswahl, Kontextmenü,
// Ctrl+Shift+C), ob wirklich etwas in der Zwischenablage gelandet ist —
// copyTextToClipboard() meldet das synchron und verlässlich (siehe deren
// eigener Kommentar für den vollen Befund: die alte navigator.clipboard.
// writeText()-Variante hier gab unabhängig vom tatsächlichen Ergebnis
// `true` zurück, deshalb feuerte die "Kopiert"-Quittung auch dann, wenn
// WKWebView den Schreibversuch lautlos abgelehnt hatte). Dedent nur bei
// mehrzeiliger Selektion — der Rand-Einzug verschachtelter CLI-/Box-UIs
// (Nutzer-Wunsch 2026-08-14), nicht die absichtliche Einrückung einer
// einzelnen kopierten Zeile.
function copySelectionFrom(terminal: Terminal): boolean {
  const selection = terminal.getSelection();
  if (!selection) return false;
  const text = selection.includes("\n") ? dedentText(selection) : selection;
  return copyTextToClipboard(text);
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
