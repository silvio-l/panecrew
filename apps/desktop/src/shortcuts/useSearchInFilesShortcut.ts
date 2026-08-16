import { useEffect } from "react";
import { isMacPlatform } from "./platform";
import { matchesShortcut, SEARCH_IN_FILES_SHORTCUT_ID, SHORTCUTS } from "./registry";

const SEARCH_SHORTCUT = SHORTCUTS.find((def) => def.id === SEARCH_IN_FILES_SHORTCUT_ID);

// Eigener, winziger Hook nach demselben Muster wie useNewWindowShortcut.ts —
// Cmd/Ctrl+Shift+F trägt keinen eigenen State, es ruft nur `onTrigger`
// (App.tsx öffnet damit den Explorer und stößt ExplorerPanel.tsx' eigenes
// Öffnen-plus-Fokussieren über dessen `openSearchSignal`-Prop an).
export function useSearchInFilesShortcut(onTrigger: () => void): void {
  useEffect(() => {
    if (!SEARCH_SHORTCUT) return;
    const isMac = isMacPlatform();

    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesShortcut(event, SEARCH_SHORTCUT, isMac)) return;
      event.preventDefault();
      onTrigger();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onTrigger]);
}
