import { describe, expect, it } from "vitest";
import { parseStoryboard, timelineEvents } from "./storyboard";
import demoStoryboardJson from "./storyboards/demo.json";

const VALID = {
  panes: [
    { slot: 0, projectName: "panecrew" },
    { slot: 1, projectName: "website" },
  ],
  focusEvents: [
    { atMs: 0, slot: 0 },
    { atMs: 4000, slot: 1 },
  ],
  typedEvents: [{ atMs: 500, slot: 0, text: "pnpm tauri dev" }],
};

describe("parseStoryboard", () => {
  it("übernimmt ein gültiges Storyboard unverändert", () => {
    expect(parseStoryboard(VALID)).toEqual(VALID);
  });

  it("wirft bei fehlendem panes-Array", () => {
    expect(() => parseStoryboard({ ...VALID, panes: undefined })).toThrow(
      /panes/,
    );
  });

  it("wirft bei negativem slot", () => {
    expect(() =>
      parseStoryboard({
        ...VALID,
        panes: [{ slot: -1, projectName: "panecrew" }],
      }),
    ).toThrow(/slot/);
  });

  it("wirft bei leerem getippten Text", () => {
    expect(() =>
      parseStoryboard({
        ...VALID,
        typedEvents: [{ atMs: 0, slot: 0, text: "" }],
      }),
    ).toThrow(/text/);
  });
});

describe("timelineEvents", () => {
  it("fasst Fokus- und Tipp-Events sortiert nach atMs zusammen", () => {
    const storyboard = parseStoryboard(VALID);
    expect(timelineEvents(storyboard)).toEqual([
      { kind: "focus", atMs: 0, slot: 0 },
      { kind: "typed", atMs: 500, slot: 0, text: "pnpm tauri dev" },
      { kind: "focus", atMs: 4000, slot: 1 },
    ]);
  });

  it("ist deterministisch: zwei Aufrufe liefern dieselbe Reihenfolge", () => {
    const storyboard = parseStoryboard(VALID);
    expect(timelineEvents(storyboard)).toEqual(timelineEvents(storyboard));
  });
});

describe("demo.json", () => {
  it("ist ein gültiges, abspielbares Beispiel-Storyboard mit 2+ Panes, Fokuswechsel und getipptem Text", () => {
    const storyboard = parseStoryboard(demoStoryboardJson);
    expect(storyboard.panes.length).toBeGreaterThanOrEqual(2);
    expect(storyboard.focusEvents.length).toBeGreaterThanOrEqual(1);
    expect(storyboard.typedEvents.length).toBeGreaterThanOrEqual(1);
  });
});
