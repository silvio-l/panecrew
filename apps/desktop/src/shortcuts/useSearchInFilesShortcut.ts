import { useEffect } from "react";
import { isMacPlatform } from "./platform";
import { matchesShortcut, SEARCH_IN_FILES_SHORTCUT_ID, SHORTCUTS } from "./registry";

const SEARCH_SHORTCUT = SHORTCUTS.find((def) => def.id === SEARCH_IN_FILES_SHORTCUT_ID);

// Eigener, winziger Hook nach demselben Muster wie useNewWindowShortcut.ts —
// Cmd/Ctrl+Shift+F trägt keinen eigenen State, es ruft nur `onTrigger`
// (App.tsx öffnet damit den Explorer und stößt ExplorerPanel.tsx' eigenes
// Öffnen-plus-Fokussieren über dessen `openSearchSignal`-Prop an).
//
// Capture-Phase + stopPropagation statt (wie useNewWindowShortcut.ts) reiner
// Bubble-Phase mit nur preventDefault: dieses Kürzel ist Strg+Umschalt+F auf
// Windows/Linux — ohne den Fang VOR xterms eigenem, an der Terminal-Fläche
// hängenden Tastatur-Handler bliebe unklar, ob xterm dieselbe Kombination
// zusätzlich als PTY-Eingabe interpretiert, bevor das Ereignis überhaupt bei
// diesem window-Listener ankäme. `stopPropagation` unterbindet genau das:
// das Ereignis erreicht die Terminal-Fläche in diesem Fall gar nicht erst.
export function useSearchInFilesShortcut(onTrigger: () => void): void {
  useEffect(() => {
    if (!SEARCH_SHORTCUT) return;
    const isMac = isMacPlatform();

    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesShortcut(event, SEARCH_SHORTCUT, isMac)) return;
      event.preventDefault();
      event.stopPropagation();
      onTrigger();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [onTrigger]);
}
