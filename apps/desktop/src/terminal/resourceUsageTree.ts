import type { Pane } from "../grid/gridState";
import { projectNameFromPath } from "../types/project";

// Reine Gruppierungslogik für die Pane→Tab-Baumansicht im Titelleisten-
// Ressourcen-Popover (`ResourceUsageTree.tsx`). Getrennt von der
// UI-Komponente (dasselbe Muster wie `gridState.ts` gegenüber
// `PaneGrid.tsx`), damit sich die Zuordnung ohne DOM/React testen lässt.
//
// Absichtlich KEINE eigene RAM/CPU-Schwellenlogik hier: welche Zeile als
// "warn"/"kritisch" markiert wird, entscheidet einzig `resourceGuard.ts`s
// bereits laufende Eskalationskette (dieselbe Quelle wie der Warn-Chip am
// Tab, `PaneTabs.tsx`) — eine zweite, hier dupliziert berechnete Schwelle
// könnte von der echten Eskalation abweichen.

/** Flaches Sample, wie es `resource_monitor.rs`s `resource-usage`-Event
 * mitliefert (`tabs`-Feld) — eine Zeile pro noch lebendem Tab, ohne
 * Pane-Zuordnung (die kennt nur der Grid-Store). `memBytes` ist die rohe
 * RSS-Summe des Tab-Prozessbaums, roh vom Backend mitgeschickt (nicht aus
 * `memPercent` zurückgerechnet — bräuchte hier zusätzlich das
 * System-Gesamt-RAM und würde Rundungsdrift einführen, s.
 * `resource_guard.rs`s `TabResourceSample`-Kommentar). */
export interface TabUsageSample {
  tabId: string;
  memPercent: number;
  cpuPercent: number;
  memBytes: number;
  /** Owning native window's label, or `null` in the brief race between a tab
   * spawning and the backend's `WindowPtyRegistry` registering it — such a
   * tab is dropped from window grouping the same way a tab with no sample
   * yet is already dropped from pane grouping below. */
  windowLabel: string | null;
}

export interface TabUsageRow extends TabUsageSample {
  /** Dieselbe Positions-Nummerierung wie der Tab-Chip selbst
   * (`PaneGrid.tsx`: `number: index + 1`) — kein zweites Nummerierungsschema. */
  number: number;
  label: string | null;
}

export interface PaneUsageGroup {
  paneId: string;
  projectName: string;
  /** Absteigend nach dem höheren der beiden Werte sortiert ("höchster
   * Verbrauch zuerst") — ein Tab, der gerade bei der CPU spitzt, soll genauso
   * nach oben wandern wie einer, der viel RAM hält. */
  tabs: TabUsageRow[];
}

function dominantPercent(row: TabUsageSample): number {
  return Math.max(row.memPercent, row.cpuPercent);
}

/** Gruppiert die flache Sample-Liste anhand des AKTUELLEN Grid-Zustands nach
 * Pane. Tabs ohne Sample (gerade erst geöffnet, vor dem ersten 5s-Tick)
 * bleiben aus der Baumansicht außen vor statt mit `0%`/`0%` zu erscheinen —
 * dasselbe "kein Platzhalter-Flackern"-Prinzip wie `ResourceUsageReadout`s
 * eigenes `usage === null`. Panes ohne ein einziges gesampeltes Tab liefern
 * gar keine Gruppe. Sowohl Panes als auch ihre Tabs sind absteigend nach
 * `dominantPercent` sortiert — der stärkste Verbraucher steht ganz oben. */
export function groupTabUsageByPane(
  panes: readonly Pane[],
  samples: readonly TabUsageSample[],
): PaneUsageGroup[] {
  const sampleByTabId = new Map(samples.map((sample) => [sample.tabId, sample]));

  const groups: { group: PaneUsageGroup; topPercent: number }[] = [];
  for (const pane of panes) {
    const rows: TabUsageRow[] = [];
    pane.terminalTabs.forEach((tab, index) => {
      const sample = sampleByTabId.get(tab.tabId);
      if (!sample) return;
      rows.push({ ...sample, number: index + 1, label: tab.label });
    });
    if (rows.length === 0) continue;
    rows.sort((a, b) => dominantPercent(b) - dominantPercent(a));
    groups.push({
      group: {
        paneId: pane.paneId,
        projectName: projectNameFromPath(pane.projectPath),
        tabs: rows,
      },
      // `rows` ist bereits absteigend sortiert, `[0]` ist damit der stärkste
      // Verbraucher der Pane — hier separat gehalten statt aus `tabs[0]`
      // zurückgelesen, weil TS dessen Nicht-Leerheit über den `continue`
      // oben hinweg nicht mehr verfolgen kann.
      topPercent: dominantPercent(rows[0] as TabUsageRow),
    });
  }
  groups.sort((a, b) => b.topPercent - a.topPercent);
  return groups.map(({ group }) => group);
}

export interface WindowInfo {
  label: string;
  title: string;
}

export interface WindowUsageGroup {
  windowLabel: string;
  windowTitle: string;
  /** Only populated for the current window — its Pane structure is the only
   * one this frontend instance has live access to. */
  panes: PaneUsageGroup[];
  /** Other windows' tabs: a flat list, no pane grouping (that window's own
   * Pane layout, and any custom tab rename, is only known to ITS OWN React
   * state — never sent over `resource-usage`). */
  tabs: TabUsageRow[];
}

/**
 * Top-level window grouping over the flat, app-wide sample list the backend
 * emits every tick (`resource_monitor.rs`'s `windowLabel` per tab). The
 * CURRENT window gets full pane grouping via `groupTabUsageByPane`, reusing
 * this window's own live grid state; every OTHER window is grouped by its
 * `windowLabel` alone into a flat, dominant-consumer-first tab list. Always
 * returns the current window first (even with zero panes: the tree the user
 * is looking at stays anchored), the rest ordered by their heaviest tab.
 * With only one window open, the result is a single-element array — callers
 * collapse that case to the pre-existing flat (no window heading) view.
 */
export function groupTabUsageByWindow(
  ownWindowLabel: string,
  windowInfos: readonly WindowInfo[],
  panes: readonly Pane[],
  samples: readonly TabUsageSample[],
): WindowUsageGroup[] {
  const ownSamples = samples.filter((sample) => sample.windowLabel === ownWindowLabel);
  const otherByWindow = new Map<string, TabUsageSample[]>();
  for (const sample of samples) {
    if (sample.windowLabel === null || sample.windowLabel === ownWindowLabel) continue;
    const list = otherByWindow.get(sample.windowLabel);
    if (list) {
      list.push(sample);
    } else {
      otherByWindow.set(sample.windowLabel, [sample]);
    }
  }

  const titleFor = (label: string) => windowInfos.find((w) => w.label === label)?.title ?? label;

  const ownGroup: WindowUsageGroup = {
    windowLabel: ownWindowLabel,
    windowTitle: titleFor(ownWindowLabel),
    panes: groupTabUsageByPane(panes, ownSamples),
    tabs: [],
  };

  const otherGroups: { group: WindowUsageGroup; topPercent: number }[] = [];
  for (const [windowLabel, windowSamples] of otherByWindow) {
    // Kein `label` bekannt (s. Interface-Kommentar oben) -> immer `null`,
    // dieselbe Positionsnummerierung wie sonst als einziger Anker.
    const rows: TabUsageRow[] = windowSamples
      .map((sample, index) => ({ ...sample, number: index + 1, label: null }))
      .sort((a, b) => dominantPercent(b) - dominantPercent(a));
    otherGroups.push({
      group: { windowLabel, windowTitle: titleFor(windowLabel), panes: [], tabs: rows },
      topPercent: dominantPercent(rows[0] as TabUsageRow),
    });
  }
  otherGroups.sort((a, b) => b.topPercent - a.topPercent);

  return [ownGroup, ...otherGroups.map(({ group }) => group)];
}

const BYTES_PER_MB = 1024 * 1024;
const BYTES_PER_GB = 1024 * BYTES_PER_MB;

/** Binärer Byte-Formatierer für die absoluten RAM-Werte im Popover (Ticket:
 * "MB unter ca. 1024, sonst GB mit einer Nachkommastelle") — sprachneutral
 * (dieselben Ziffern/Einheiten in DE/EN, wie schon die Prozentwerte daneben),
 * deshalb kein `Intl.NumberFormat`. Rundet ZUERST auf ganze MB und prüft DANN
 * die Schwelle, statt den rohen Bytewert gegen 1 GB zu prüfen — sonst könnte
 * ein Wert knapp unter 1 GB (z. B. 1023,6 MB) als "1024 MB" statt als GB
 * erscheinen. */
export function formatMemoryBytes(bytes: number): string {
  const roundedMb = Math.round(bytes / BYTES_PER_MB);
  if (roundedMb < 1024) {
    return `${roundedMb} MB`;
  }
  return `${(bytes / BYTES_PER_GB).toFixed(1)} GB`;
}
