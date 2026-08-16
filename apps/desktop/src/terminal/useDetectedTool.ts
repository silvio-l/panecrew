import { useEffect, useState } from "react";
import { usePtyBackend } from "./ptyBackend";

// Prozessbaum-Polling über IPC (`pty_detect_tool`), kein Streaming-Signal
// wie die eigentliche PTY-Ausgabe — 2s hält den Icon-Wechsel (z. B. Shell →
// laufender CLI-Agent kurz nach dessen Start) nah genug an "sofort", ohne
// bei vielen gleichzeitig offenen Tabs spürbar IPC-Last zu erzeugen.
const POLL_INTERVAL_MS = 2000;

/** Kanonische Tool-ID (siehe `TOOL_BY_ID` in `toolIcons.tsx`) des aktivsten
 * erkannten Prozessbaum-Nachfahren einer Terminal-Tab-Shell — `null` bis zur
 * ersten Antwort oder wenn nichts (mehr) erkennbar ist (Tab noch nicht
 * gespawnt, gerade geschlossen, ein laufender aber nicht erkannter Prozess,
 * o. ä.). `tool_detect.rs` matcht bereits gegen Prozessname UND volle
 * Argumente (Node-CLI-Shebang-Problem: der OS-Prozess heißt dann "node",
 * nicht nach dem Tool selbst) — dieser Hook bekommt schon die fertige ID,
 * kein roher Binärname mehr. Mapping auf ein anzeigbares Icon macht bewusst
 * nicht dieser Hook, sondern `toolIcons.tsx`s `resolveToolIcon` — hier steht
 * nur die IPC-Seite. */
export function useDetectedToolId(tabId: string): string | null {
  const ptyBackend = usePtyBackend();
  const [toolId, setToolId] = useState<string | null>(null);

  useEffect(() => {
    // Kein expliziter Reset auf `null` beim Tabwechsel nötig: `PaneTabs.tsx`
    // rendert `TerminalTabChip` mit `key={tab.tabId}`, ein anderes `tabId`
    // ist für React also ohnehin ein Neumount mit frischem `useState(null)`.
    let cancelled = false;

    // Skips the IPC round-trip while this window is minimized/backgrounded
    // (2026-08-16 perf audit: N open tabs × every open window each polling
    // independently adds up to real, un-gated IPC traffic for icons nobody
    // can see). Deliberately keyed on `document.visibilityState`, i.e. this
    // WHOLE window's visibility, not this specific tab's — a background tab
    // within a visible, focused window still needs live updates, that's the
    // point of showing a tool icon on its chip without switching to it.
    const poll = () => {
      if (document.visibilityState !== "visible") return;
      void ptyBackend.detectTool(tabId).then((detected) => {
        if (!cancelled) setToolId(detected);
      });
    };
    poll();
    const timer = window.setInterval(poll, POLL_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") poll();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [ptyBackend, tabId]);

  return toolId;
}
