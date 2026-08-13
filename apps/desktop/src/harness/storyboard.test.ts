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
  templateEvents: [{ atMs: 6000, template: "split" as const }],
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

  it("erlaubt ein fehlendes templateEvents-Array (Rückwärtskompatibilität)", () => {
    const withoutTemplateEvents = {
      panes: VALID.panes,
      focusEvents: VALID.focusEvents,
      typedEvents: VALID.typedEvents,
    };
    expect(parseStoryboard(withoutTemplateEvents)).toEqual({
      ...withoutTemplateEvents,
      templateEvents: [],
    });
  });

  it("wirft bei unbekannter Template-Id", () => {
    expect(() =>
      parseStoryboard({
        ...VALID,
        templateEvents: [{ atMs: 0, template: "hex-grid" }],
      }),
    ).toThrow(/template/);
  });
});

describe("timelineEvents", () => {
  it("fasst Fokus-, Tipp- und Template-Events sortiert nach atMs zusammen", () => {
    const storyboard = parseStoryboard(VALID);
    expect(timelineEvents(storyboard)).toEqual([
      { kind: "focus", atMs: 0, slot: 0 },
      { kind: "typed", atMs: 500, slot: 0, text: "pnpm tauri dev" },
      { kind: "focus", atMs: 4000, slot: 1 },
      { kind: "template", atMs: 6000, template: "split" },
    ]);
  });

  it("ist deterministisch: zwei Aufrufe liefern dieselbe Reihenfolge", () => {
    const storyboard = parseStoryboard(VALID);
    expect(timelineEvents(storyboard)).toEqual(timelineEvents(storyboard));
  });
});

describe("demo.json", () => {
  it("ist ein gültiges, abspielbares Beispiel-Storyboard mit 2+ Panes, Fokuswechsel, getipptem Text und einem Template-Wechsel", () => {
    const storyboard = parseStoryboard(demoStoryboardJson);
    expect(storyboard.panes.length).toBeGreaterThanOrEqual(2);
    expect(storyboard.focusEvents.length).toBeGreaterThanOrEqual(1);
    expect(storyboard.typedEvents.length).toBeGreaterThanOrEqual(1);
    expect(storyboard.templateEvents.length).toBeGreaterThanOrEqual(1);
  });
});
