// Gegenstück zu `theme/applyTheme.ts`, derselbe Live-Reload-über-alle-Fenster-
// Mechanismus (Ticket 05), jetzt für `appearance.language` statt
// `appearance.theme`: main.tsx, about/main.tsx, settings/main.tsx binden ihn
// alle auf dieselbe Weise ein. Der TitleBar-Sprachumschalter ist damit
// überflüssig geworden (2026-08-13, Nutzerentscheidung) — die Sprache wird
// jetzt ausschließlich über die Settings gesetzt, hier nur noch angewendet.
//
// Fetch/Abo laufen seit Ticket 08 über `settingsStore.ts` (s. dessen
// Kopfkommentar) statt über ein eigenes `invoke`/`listen`.
import { getSettingsValues, subscribeToSettingsChanges } from "../settings/settingsStore";
import { isSupportedLanguage, setLanguage } from "./index";

/**
 * Startet die Anwendung von `appearance.language` in diesem Fenster und hält
 * sie live: der initiale Wert aus dem Backend plus jede spätere
 * `settings:changed`-Änderung. Gibt eine Unsubscribe-Funktion zurück
 * (derselbe, in der Praxis nie genutzte Cleanup-Vertrag wie
 * `initThemeApplier`).
 */
export function initLanguageApplier(): () => void {
  const applyFromValues = (values: Record<string, unknown>) => {
    const language = values["appearance.language"];
    if (typeof language === "string" && isSupportedLanguage(language)) {
      setLanguage(language);
    }
  };
  void getSettingsValues().then(applyFromValues);

  const unsubscribe = subscribeToSettingsChanges((event) => {
    if (
      event.key === "appearance.language" &&
      typeof event.value === "string" &&
      isSupportedLanguage(event.value)
    ) {
      setLanguage(event.value);
    } else if (event.key === "*") {
      applyFromValues(event.values);
    }
  });

  return unsubscribe;
}
