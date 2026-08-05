import { useCallback, useEffect, useRef } from "react";
import type { RefObject } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { isMacPlatform } from "../shortcuts/platform";
import { matchesShortcut, SHORTCUTS } from "../shortcuts/registry";
import { DEFAULT_ZOOM, nextZoomLevel } from "../shortcuts/zoom";
import { routeCompletionKey } from "./completionKeys";
import { attachInlineSuggestion } from "./inlineSuggestion";
import { createChunkDecoder, formatDroppedPaths } from "./ptyIo";
import { loadShellHistory } from "./shellHistory";
import { readTerminalOptions, readTerminalTheme } from "./terminalTheme";
import {
  createDirectoryProbe,
  createSubdirectoryIndex,
  parseOsc7,
} from "./workingDirectory";

// Bindet ein echtes xterm.js-Terminal an eine PTY-Session im Rust-Backend.
// Der IPC-Vertrag (pty_spawn/pty_write/pty_resize/pty_kill, Output als
// Channel<number[]>) ist eingefroren, siehe
// .scratch/panecrew-v0.1/issues/02-ipc-contract.md — hier wird exakt dagegen
// gebaut, nichts erfunden.
//
// Der gesamte imperative Lebenszyklus (Terminal, FitAddon, Channel, Spawn/Kill,
// Webview-Drag-Drop) liegt in genau einem Effekt; die Komponente darüber bleibt
// reines Chrome. Ticket 03 mountet denselben Hook mehrfach — `paneId` ist
// bereits pro Session eigenständig.

/** Bytes, die wir selbst erzeugen (Shift+Enter). */
const LINE_FEED = 0x0a;

export interface PtyTerminal {
  /** Container, in den xterm.js sein DOM hängt. */
  containerRef: RefObject<HTMLDivElement | null>;
  copySelection: () => void;
  paste: () => void;
  clear: () => void;
  focus: () => void;
  hasSelection: () => boolean;
}

export function usePtyTerminal(cwd: string): PtyTerminal {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // paneId wird bewusst INNERHALB des Effekts erzeugt: Reacts StrictMode
    // führt Mount-Effekte doppelt aus (mount → cleanup → mount). Mit einer
    // stabilen, außen erzeugten Id würde der zweite pty_spawn denselben
    // HashMap-Key im Backend überschreiben und den ersten Kindprozess
    // verwaisen lassen. Zwei Durchläufe → zwei Ids → der erste wird sauber
    // gekillt, der zweite lebt.
    const paneId = crypto.randomUUID();

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
    // Erst messen, dann spawnen: pty_spawn nimmt cols/rows entgegen, und die
    // Shell druckt ihren ersten Prompt bereits in dieser Breite.
    fitAddon.fit();
    terminal.focus();
    terminalRef.current = terminal;

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
      void invoke("pty_write", { paneId, data: Array.from(bytes) }).catch(
        reportIpcFailure,
      );
    };
    const writeText = (text: string) =>
      writeBytes(new TextEncoder().encode(text));
    const syncSize = () => {
      if (!sessionReady) return;
      void invoke("pty_resize", {
        paneId,
        cols: terminal.cols,
        rows: terminal.rows,
      }).catch(reportIpcFailure);
    };

    // Genau EIN Decoder pro Pane (Begründung in ptyIo.ts).
    const decodeChunk = createChunkDecoder();
    const onOutput = new Channel<number[]>();
    onOutput.onmessage = (bytes) => {
      if (disposed) return;
      terminal.write(decodeChunk(bytes));
    };

    void invoke("pty_spawn", {
      paneId,
      cwd,
      cols: terminal.cols,
      rows: terminal.rows,
      onOutput,
    })
      .then(() => {
        sessionReady = true;
        if (cancelled) {
          killPane(paneId);
          return;
        }
        // Zwischen fit() und dem Auflösen des Spawns kann sich der Container
        // schon wieder verändert haben — einmal nachziehen.
        syncSize();
      })
      .catch((error: unknown) => {
        // Kein stiller leerer Kasten: der Fehler landet sichtbar im Puffer.
        if (disposed) return;
        terminal.write(
          `\r\n\x1b[31mPTY konnte nicht gestartet werden: ${String(error)}\x1b[0m\r\n`,
        );
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
      const paneShortcut = SHORTCUTS.find(
        (def) =>
          def.scope === "pane" && matchesShortcut(event, def, isMacPlatform()),
      );
      if (paneShortcut) {
        // `return false` hält nur xterm ab; ohne preventDefault zoomte der
        // Webview auf derselben Taste zusätzlich mit.
        event.preventDefault();
        applyPaneZoom(
          paneShortcut.glyph === "0"
            ? DEFAULT_ZOOM
            : nextZoomLevel(paneZoom, paneShortcut.glyph === "+" ? 1 : -1),
        );
        return false;
      }

      // Verzeichnis-Popup und Geistertext: welche Taste ihnen gehört, steht
      // in completionKeys.ts — der Teil ist für sich prüfbar, weil an ihm ein
      // gemeldeter Fehler hing.
      if (routeCompletionKey(event, suggestion)) return false;

      // Shift+Enter: weicher Zeilenumbruch statt Absenden. Ink-basierte CLI-
      // Tools (claude) lesen den blanken Linefeed als Zeilenumbruch im Prompt,
      // während \r (Enter) abschickt.
      if (
        event.key === "Enter" &&
        event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        writeBytes(new Uint8Array([LINE_FEED]));
        return false;
      }

      // Ctrl+Shift+C/V — die VS-Code-Bindings auf Windows/Linux. Cmd+C/Cmd+V
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
    // Event; ein HTML5-drop-Event liefert File-Objekte ohne Pfad.
    //
    // `dragDropEnabled` musste in tauri.conf.json NICHT gesetzt werden: die
    // Option ist per Default aktiv (Tauri 2, WebviewOptions.dragDropEnabled —
    // "By default it is enabled"), und genau dieser Default ist der, den wir
    // brauchen. Kehrseite und Grund, warum hier kein DOM-Handler steht: solange
    // sie aktiv ist, ist DOM-Drag-and-Drop im Webview abgeschaltet.
    //
    // Das Event ist fensterweit — mit genau einer Pane eindeutig; Ticket 03
    // muss die mitgelieferte Position gegen die Pane-Rechtecke prüfen.
    let unlistenDrop: UnlistenFn | null = null;
    let dropListenerDisposed = false;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return;
        const text = formatDroppedPaths(event.payload.paths);
        // Trailing Space, damit direkt weitergetippt werden kann ("<pfad> was
        // ist hier kaputt?") — der Kernfall für CLI-Agenten.
        if (!text) return;
        // Dieser Weg läuft an onData vorbei, der Ankerpunkt der Vorschläge
        // bekäme den Einwurf also nicht mit.
        suggestion.reset();
        writeText(`${text} `);
      })
      .then((unlisten) => {
        if (dropListenerDisposed) unlisten();
        else unlistenDrop = unlisten;
      })
      .catch(reportIpcFailure);

    return () => {
      cancelled = true;
      disposed = true;
      dropListenerDisposed = true;
      unlistenDrop?.();
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
      if (sessionReady) killPane(paneId);
    };
  }, [cwd]);

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

  return { containerRef, copySelection, paste, clear, focus, hasSelection };
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

function killPane(paneId: string): void {
  void invoke("pty_kill", { paneId }).catch(reportIpcFailure);
}

function reportIpcFailure(error: unknown): void {
  console.error("PaneCrew: PTY-IPC fehlgeschlagen", error);
}

function noop(): void {
  /* Clipboard-Zugriff darf fehlschlagen, ohne die Pane zu stören. */
}
