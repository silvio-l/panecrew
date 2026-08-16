import { afterEach, describe, expect, it } from "vitest";
import i18next, { setLanguage } from "./index";

// Kriterium aus Ticket 16: Sprachumschaltung wirkt zur Laufzeit, ohne
// Neustart der App — hier direkt an der i18next-Instanz statt über eine UI,
// weil das der Mechanismus ist, den jede Komponente über useTranslation()
// letztlich beobachtet.
describe("Laufzeit-Sprachumschaltung", () => {
  afterEach(() => {
    // `test/setup.ts` fixiert die Testsprache global auf Deutsch, unabhängig
    // vom App-Default (dessen eigener Kommentar dort) — jeder Test hier
    // stellt das selbst wieder her, statt sich auf einen ambienten
    // Ausgangszustand zu verlassen.
    setLanguage("de");
  });

  it("wechselt übersetzte Strings ohne Neuinitialisierung", () => {
    setLanguage("en");
    expect(i18next.language).toBe("en");
    expect(i18next.t("titleBar.settings")).toBe("Settings");

    setLanguage("de");

    expect(i18next.language).toBe("de");
    expect(i18next.t("titleBar.settings")).toBe("Einstellungen");
  });
});
