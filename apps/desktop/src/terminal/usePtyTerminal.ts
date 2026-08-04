import { useCallback, useEffect, useRef } from "react";
import type { RefObject } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { createChunkDecoder, formatDroppedPaths } from "./ptyIo";
import { readTerminalOptions, readTerminalTheme } from "./terminalTheme";

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

    const terminal = new Terminal({
      allowTransparency: false,
      cursorBlink: true,
      ...readTerminalOptions(),
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

    const disposables = [
      terminal.onData(writeText),
      // xterm feuert onResize nur bei tatsächlicher Dimensionsänderung — das
      // ist genau die Bedingung des IPC-Vertrags für pty_resize.
      terminal.onResize(syncSize),
    ];

    terminal.attachCustomKeyEventHandler((event) => {
      // attachCustomKeyEventHandler wird für keydown UND keypress aufgerufen;
      // ohne diese Prüfung würde jeder Tastendruck doppelt behandelt.
      if (event.type !== "keydown") return true;

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
        if (text) writeText(`${text} `);
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
