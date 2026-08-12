import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import de from "./locales/de.json";
import en from "./locales/en.json";

export const SUPPORTED_LANGUAGES = ["de", "en"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const STORAGE_KEY = "panecrew-language";

function isSupportedLanguage(value: string | null): value is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value ?? "");
}

// Persistierte Wahl schlägt den Default — sonst würde jede Umschaltung den
// nächsten App-Start wieder auf Deutsch zurückwerfen. `localStorage` reicht
// hier: das ist eine reine UI-Präferenz, kein Fachdatum, das `session.json`
// tragen müsste.
function initialLanguage(): SupportedLanguage {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isSupportedLanguage(stored) ? stored : "de";
}

export function setLanguage(language: SupportedLanguage): void {
  window.localStorage.setItem(STORAGE_KEY, language);
  void i18next.changeLanguage(language);
}

// `initAsync: false` hält `init()` synchron ab, statt den Abschluss per
// `setTimeout` auf den nächsten Tick zu verschieben — die Übersetzungs-
// ressourcen liegen als statische Imports ohnehin schon vollständig vor. Ohne
// das rendert der allererste Frame (und jeder Testlauf, der sofort mountet)
// mit fehlenden Ressourcen.
void i18next.use(initReactI18next).init({
  resources: {
    de: { translation: de },
    en: { translation: en },
  },
  lng: initialLanguage(),
  fallbackLng: "de",
  interpolation: { escapeValue: false },
  initAsync: false,
});

export default i18next;
