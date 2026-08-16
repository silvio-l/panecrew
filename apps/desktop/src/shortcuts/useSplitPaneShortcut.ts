import { useEffect } from "react";
import { isMacPlatform } from "./platform";
import { matchesShortcut, SHORTCUTS, SPLIT_PANE_SHORTCUT_ID } from "./registry";

const SPLIT_SHORTCUT = SHORTCUTS.find((def) => def.id === SPLIT_PANE_SHORTCUT_ID);

// Dasselbe winzige Muster wie useSearchInFilesShortcut.ts — auch hier
// Capture-Phase + stopPropagation statt bloßer Bubble-Phase, aus demselben
// Grund: Ctrl+Shift+5 ist ein Ziffern-Chord, ohne den Fang vor xterms eigenem
// Tastatur-Handler bliebe unklar, ob die Terminal-Fläche dieselbe Kombination
// zusätzlich als PTY-Eingabe sähe.
export function useSplitPaneShortcut(onTrigger: () => void): void {
  useEffect(() => {
    if (!SPLIT_SHORTCUT) return;
    const isMac = isMacPlatform();

    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesShortcut(event, SPLIT_SHORTCUT, isMac)) return;
      event.preventDefault();
      event.stopPropagation();
      onTrigger();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [onTrigger]);
}
