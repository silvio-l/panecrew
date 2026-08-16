import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isMacPlatform } from "./platform";
import { matchesShortcut, NEW_WINDOW_SHORTCUT_ID, SHORTCUTS } from "./registry";

const NEW_WINDOW_SHORTCUT = SHORTCUTS.find(
  (def) => def.id === NEW_WINDOW_SHORTCUT_ID,
);

// Eigener, winziger Hook statt in useAppZoom.ts mitgezogen (Ticket 27) — der
// dort verwaltet Zoom-State, hier gibt es keinen: ⌘N/Ctrl+N löst direkt
// denselben Tauri-Command aus wie der "Neues Fenster"-Knopf in TitleBar.tsx
// (`window_open_new` generiert Label/Kaskaden-Position selbst).
export function useNewWindowShortcut(): void {
  useEffect(() => {
    if (!NEW_WINDOW_SHORTCUT) return;
    const isMac = isMacPlatform();

    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesShortcut(event, NEW_WINDOW_SHORTCUT, isMac)) return;
      event.preventDefault();
      void invoke("window_open_new", { initialProject: null });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
