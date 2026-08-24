import { describe, expect, it } from "vitest";
import { INITIAL_GRID_STATE, assignProjectToSlot } from "../grid/gridState";
import { onboardingHintSlot, onboardingHintVariant, onboardingShouldComplete } from "./onboardingState";

describe("onboardingState", () => {
  it("zeigt den Hinweis am ersten leeren Slot einer frischen Grid", () => {
    expect(onboardingHintSlot(INITIAL_GRID_STATE)).toBe(0);
  });

  it("wählt die nächste leere Lücke, wenn Slot 0 schon belegt ist", () => {
    const withOnePane = assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/storefront", "pane-1", "tab-1");

    expect(onboardingHintSlot(withOnePane)).toBe(1);
  });

  it("liefert null, wenn kein Slot mehr frei ist", () => {
    const full = ["/a", "/b", "/c", "/d"].reduce(
      (state, path, index) => assignProjectToSlot(state, index, path, `pane-${index}`, `tab-${index}`),
      INITIAL_GRID_STATE,
    );

    expect(onboardingHintSlot(full)).toBeNull();
  });

  it("zeigt die Erstlauf-Variante bei einer komplett leeren Grid", () => {
    expect(onboardingHintVariant(INITIAL_GRID_STATE)).toBe("empty");
  });

  it("zeigt die Folge-Variante, sobald mindestens eine Pane offen ist", () => {
    const withOnePane = assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/storefront", "pane-1", "tab-1");

    expect(onboardingHintVariant(withOnePane)).toBe("hasPanes");
  });

  it("ist noch nicht abgeschlossen bei nur einer offenen Pane", () => {
    const withOnePane = assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/storefront", "pane-1", "tab-1");

    expect(onboardingShouldComplete(withOnePane)).toBe(false);
  });

  it("gilt als abgeschlossen, sobald zwei Panes gleichzeitig offen sind", () => {
    const withTwoPanes = assignProjectToSlot(
      assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/storefront", "pane-1", "tab-1"),
      1,
      "/repo/api",
      "pane-2",
      "tab-2",
    );

    expect(onboardingShouldComplete(withTwoPanes)).toBe(true);
  });
});
