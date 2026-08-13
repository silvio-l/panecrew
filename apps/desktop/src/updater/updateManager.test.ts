import { beforeEach, describe, expect, it } from "vitest";
import { AUTO_CHECK_ENABLED, shouldAutoCheck } from "./updateManager";

// Aktivierungsgrenze aus Ticket 30, Punkt 7: der automatische Check ist aktiv,
// seit das reale Repo öffentlich ist (2026-08-13). Dieser Test hält fest, dass
// das Flag an ist UND dass die Drosselung (ein Versuch pro 24h) tatsächlich
// greift — ein Fehler hier wäre entweder "nie ein Auto-Check" oder "bei jedem
// Start ein Auto-Check", beides unerwünscht.
describe("shouldAutoCheck", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("ist an und lässt maximal einen Check pro 24h zu", () => {
    expect(AUTO_CHECK_ENABLED).toBe(true);
    expect(shouldAutoCheck()).toBe(true); // noch nie geprüft

    localStorage.setItem("panecrew.updater.lastAutoCheckAt", String(Date.now()));
    expect(shouldAutoCheck()).toBe(false); // gerade erst geprüft

    localStorage.setItem(
      "panecrew.updater.lastAutoCheckAt",
      String(Date.now() - 25 * 60 * 60 * 1000),
    );
    expect(shouldAutoCheck()).toBe(true); // länger als 24h her
  });
});
