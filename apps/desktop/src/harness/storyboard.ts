// Das deklarative Format, das der Storyboard-Player (`useStoryboardPlayer.ts`)
// abspielt: welche Panes mit welchem simulierten Projekt-Namen vorbelegt
// sind (statisch, keine Zeitachse — die Preconditions der Spec verlangen
// ohnehin bereits zugewiesene Panes vor jedem Dreh), dazu je eine Zeitachse
// für Fokuswechsel, für "getippten" Text und für Grid-Template-Wechsel.
// `atMs` ist relativ zum Start der Wiedergabe, nicht absolut.

import { GRID_TEMPLATES, type TemplateId } from "../grid/gridState";

interface StoryboardPane {
  slot: number;
  projectName: string;
}

interface StoryboardFocusEvent {
  atMs: number;
  slot: number;
}

interface StoryboardTypedEvent {
  atMs: number;
  slot: number;
  text: string;
}

interface StoryboardTemplateEvent {
  atMs: number;
  template: TemplateId;
}

export interface Storyboard {
  panes: readonly StoryboardPane[];
  focusEvents: readonly StoryboardFocusEvent[];
  typedEvents: readonly StoryboardTypedEvent[];
  templateEvents: readonly StoryboardTemplateEvent[];
}

export type TimelineEvent =
  | { kind: "focus"; atMs: number; slot: number }
  | { kind: "typed"; atMs: number; slot: number; text: string }
  | { kind: "template"; atMs: number; template: TemplateId };

/** Wirft mit einer konkreten Fehlermeldung, statt eine strukturell falsche
 * Storyboard-Datei erst beim Abspielen (oder gar nicht) auffallen zu lassen
 * — Ticket 04s Pipeline-CLI liest diese Dateien künftig aus einem
 * handgepflegten JSON, nicht aus TypeScript. */
export function parseStoryboard(data: unknown): Storyboard {
  if (typeof data !== "object" || data === null) {
    throw new Error("Storyboard muss ein Objekt sein");
  }
  const raw = data as Record<string, unknown>;

  const panes = parseArray(raw.panes, "panes", (entry, path) => {
    const pane = expectObject(entry, path);
    return {
      slot: expectNonNegativeInt(pane.slot, `${path}.slot`),
      projectName: expectNonEmptyString(pane.projectName, `${path}.projectName`),
    };
  });

  const focusEvents = parseArray(raw.focusEvents, "focusEvents", (entry, path) => {
    const event = expectObject(entry, path);
    return {
      atMs: expectNonNegativeInt(event.atMs, `${path}.atMs`),
      slot: expectNonNegativeInt(event.slot, `${path}.slot`),
    };
  });

  const typedEvents = parseArray(raw.typedEvents, "typedEvents", (entry, path) => {
    const event = expectObject(entry, path);
    return {
      atMs: expectNonNegativeInt(event.atMs, `${path}.atMs`),
      slot: expectNonNegativeInt(event.slot, `${path}.slot`),
      text: expectNonEmptyString(event.text, `${path}.text`),
    };
  });

  // Optional, anders als die drei Arrays oben: bestehende Storyboards ohne
  // Template-Wechsel (z. B. ältere Fixtures) bleiben gültig, statt ein
  // fehlendes Feld als Fehler zu werten.
  const templateEvents = parseArray(
    raw.templateEvents ?? [],
    "templateEvents",
    (entry, path) => {
      const event = expectObject(entry, path);
      return {
        atMs: expectNonNegativeInt(event.atMs, `${path}.atMs`),
        template: expectTemplateId(event.template, `${path}.template`),
      };
    },
  );

  return { panes, focusEvents, typedEvents, templateEvents };
}

/** Fasst Fokus- und Tipp-Events zu einer nach `atMs` sortierten Zeitachse
 * zusammen — stabil sortiert, damit zwei gleichzeitige Events immer in
 * derselben, aus der Storyboard-Datei ableitbaren Reihenfolge feuern
 * (Determinismus, Ticket-02-Akzeptanz). */
export function timelineEvents(storyboard: Storyboard): readonly TimelineEvent[] {
  const events: TimelineEvent[] = [
    ...storyboard.focusEvents.map(
      (event): TimelineEvent => ({ kind: "focus", atMs: event.atMs, slot: event.slot }),
    ),
    ...storyboard.typedEvents.map(
      (event): TimelineEvent => ({
        kind: "typed",
        atMs: event.atMs,
        slot: event.slot,
        text: event.text,
      }),
    ),
    ...storyboard.templateEvents.map(
      (event): TimelineEvent => ({
        kind: "template",
        atMs: event.atMs,
        template: event.template,
      }),
    ),
  ];
  // `.sort()` statt `.toSorted()` (ES2023, außerhalb des konfigurierten
  // `lib`-Ziels, s. tsconfig.json) — stabil seit ES2019 in jeder hier
  // relevanten Engine (V8/JSC), Kopie zuerst, damit der Aufrufer sein Array
  // nicht mutiert zurückbekommt.
  return [...events].sort((a, b) => a.atMs - b.atMs);
}

function parseArray<T>(
  value: unknown,
  path: string,
  mapEntry: (entry: unknown, entryPath: string) => T,
): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`Storyboard.${path} muss ein Array sein`);
  }
  return value.map((entry, index) => mapEntry(entry, `${path}[${index}]`));
}

function expectObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Storyboard.${path} muss ein Objekt sein`);
  }
  return value as Record<string, unknown>;
}

function expectNonNegativeInt(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Storyboard.${path} muss eine nicht-negative Ganzzahl sein`);
  }
  return value;
}

function expectNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Storyboard.${path} muss ein nicht-leerer String sein`);
  }
  return value;
}

const VALID_TEMPLATE_IDS = GRID_TEMPLATES.map((t) => t.id);

function expectTemplateId(value: unknown, path: string): TemplateId {
  if (
    typeof value !== "string" ||
    !VALID_TEMPLATE_IDS.includes(value as TemplateId)
  ) {
    throw new Error(
      `Storyboard.${path} muss eines von ${VALID_TEMPLATE_IDS.join(", ")} sein`,
    );
  }
  return value as TemplateId;
}
