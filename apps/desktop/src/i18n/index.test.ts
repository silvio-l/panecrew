import { afterEach, describe, expect, it } from "vitest";
import i18next, { setLanguage } from "./index";

// Kriterium aus Ticket 16: Sprachumschaltung wirkt zur Laufzeit, ohne
// Neustart der App — hier direkt an der i18next-Instanz statt über eine UI,
// weil das der Mechanismus ist, den jede Komponente über useTranslation()
// letztlich beobachtet.
describe("Laufzeit-Sprachumschaltung", () => {
  afterEach(() => {
    setLanguage("de");
  });

  it("wechselt übersetzte Strings ohne Neuinitialisierung", () => {
    expect(i18next.t("titleBar.settings")).toBe("Einstellungen");

    setLanguage("en");

    expect(i18next.language).toBe("en");
    expect(i18next.t("titleBar.settings")).toBe("Settings");
  });
});
