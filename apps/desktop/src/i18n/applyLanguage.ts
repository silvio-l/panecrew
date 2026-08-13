// Gegenstück zu `theme/applyTheme.ts`, derselbe Live-Reload-über-alle-Fenster-
// Mechanismus (Ticket 05), jetzt für `appearance.language` statt
// `appearance.theme`: main.tsx, about/main.tsx, settings/main.tsx binden ihn
// alle auf dieselbe Weise ein. Der TitleBar-Sprachumschalter ist damit
// überflüssig geworden (2026-08-13, Nutzerentscheidung) — die Sprache wird
// jetzt ausschließlich über die Settings gesetzt, hier nur noch angewendet.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isSupportedLanguage, setLanguage } from "./index";

/**
 * Startet die Anwendung von `appearance.language` in diesem Fenster und hält
 * sie live: der initiale Wert aus dem Backend plus jede spätere
 * `settings:changed`-Änderung. Gibt eine Unsubscribe-Funktion zurück
 * (derselbe, in der Praxis nie genutzte Cleanup-Vertrag wie
 * `initThemeApplier`).
 */
export function initLanguageApplier(): () => void {
  const refreshFromBackend = () => {
    void invoke<Record<string, unknown>>("settings_get_values").then((values) => {
      const language = values["appearance.language"];
      if (typeof language === "string" && isSupportedLanguage(language)) {
        setLanguage(language);
      }
    });
  };
  refreshFromBackend();

  const unlistenPromise = listen<{ key: string; value: unknown }>(
    "settings:changed",
    (event) => {
      const { key, value } = event.payload;
      if (key === "appearance.language" && typeof value === "string" && isSupportedLanguage(value)) {
        setLanguage(value);
      } else if (key === "*") {
        refreshFromBackend();
      }
    },
  );

  return () => {
    void unlistenPromise.then((unlisten) => unlisten());
  };
}
