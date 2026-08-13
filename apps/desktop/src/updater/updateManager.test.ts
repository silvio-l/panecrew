import { beforeEach, describe, expect, it } from "vitest";
import { AUTO_CHECK_ENABLED, shouldAutoCheck } from "./updateManager";

// Aktivierungsgrenze aus Ticket 30, Punkt 7: der automatische Check bleibt
// aus, bis das reale Repo öffentlich ist. Dieser Test hält genau das fest —
// ein Flag-Dreher hier wäre der Moment, in dem jeder Nutzer beim nächsten
// Start plötzlich echte Netzwerkanfragen gegen ein noch privates Repo schickt.
describe("shouldAutoCheck", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("bleibt aus, solange AUTO_CHECK_ENABLED false ist — unabhängig vom letzten Checkzeitpunkt", () => {
    expect(AUTO_CHECK_ENABLED).toBe(false);
    expect(shouldAutoCheck()).toBe(false);

    localStorage.setItem("panecrew.updater.lastAutoCheckAt", "0");
    expect(shouldAutoCheck()).toBe(false);
  });
});
