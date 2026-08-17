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

/** Window-agnostic pane/tab structure — everything the grouping below needs,
 * whether it comes from this window's own `Pane[]` grid state
 * (`groupTabUsageByPane`) or from a foreign window via `windowState.ts`'s
 * cross-window broadcast (`groupTabUsageByWindow`'s `foreignPaneStructures`).
 * One shared input type instead of two grouping implementations that could
 * otherwise drift apart. */
interface PaneStructureTab {
  tabId: string;
  label: string | null;
}

export interface PaneStructure {
  paneId: string;
  projectName: string;
  tabs: readonly PaneStructureTab[];
}

/** Groups the flat sample list against an already window-agnostic pane
 * structure. Tabs without a sample (just opened, before the first 5s tick)
 * stay out of the tree view instead of appearing as `0%`/`0%` — the same
 * "no placeholder flicker" principle as `ResourceUsageReadout`'s own
 * `usage === null`. Panes with no sampled tab at all yield no group. Both
 * panes and their tabs are sorted descending by `dominantPercent` — the
 * heaviest consumer sits on top. */
function groupTabUsageByPaneStructure(
  paneStructures: readonly PaneStructure[],
  samples: readonly TabUsageSample[],
): PaneUsageGroup[] {
  const sampleByTabId = new Map(samples.map((sample) => [sample.tabId, sample]));

  const groups: { group: PaneUsageGroup; topPercent: number }[] = [];
  for (const paneStructure of paneStructures) {
    const rows: TabUsageRow[] = [];
    paneStructure.tabs.forEach((tab, index) => {
      const sample = sampleByTabId.get(tab.tabId);
      if (!sample) return;
      rows.push({ ...sample, number: index + 1, label: tab.label });
    });
    if (rows.length === 0) continue;
    rows.sort((a, b) => dominantPercent(b) - dominantPercent(a));
    groups.push({
      group: {
        paneId: paneStructure.paneId,
        projectName: paneStructure.projectName,
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

/** Derives the window-agnostic structure from this window's own, live
 * `Pane[]` grid state — the same shape this window also publishes for other
 * windows under the `"pane-tree"` topic (`TitleBar.tsx`). */
export function paneStructuresFromPanes(panes: readonly Pane[]): PaneStructure[] {
  return panes.map((pane) => ({
    paneId: pane.paneId,
    projectName: projectNameFromPath(pane.projectPath),
    tabs: pane.terminalTabs.map((tab) => ({ tabId: tab.tabId, label: tab.label })),
  }));
}

export function groupTabUsageByPane(
  panes: readonly Pane[],
  samples: readonly TabUsageSample[],
): PaneUsageGroup[] {
  return groupTabUsageByPaneStructure(paneStructuresFromPanes(panes), samples);
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
 * this window's own live grid state. Every OTHER window gets the SAME pane
 * grouping (`groupTabUsageByPaneStructure`) whenever its structure has
 * already arrived via `windowState.ts`'s `"pane-tree"` cross-window
 * broadcast (`foreignPaneStructures`, keyed by window label); any of its
 * tabs not yet covered by that structure (the brief race before that
 * window's first publish lands) fall back to a flat, generically-numbered
 * row, same as before this broadcast existed. Always returns the current
 * window first (even with zero panes: the tree the user is looking at stays
 * anchored), the rest ordered by their heaviest tab. With only one window
 * open, the result is a single-element array — callers collapse that case to
 * the pre-existing flat (no window heading) view.
 */
export function groupTabUsageByWindow(
  ownWindowLabel: string,
  windowInfos: readonly WindowInfo[],
  panes: readonly Pane[],
  samples: readonly TabUsageSample[],
  foreignPaneStructures: ReadonlyMap<string, readonly PaneStructure[]> = new Map(),
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
    const structure = foreignPaneStructures.get(windowLabel);
    const panesForWindow = structure ? groupTabUsageByPaneStructure(structure, windowSamples) : [];
    const groupedTabIds = new Set(panesForWindow.flatMap((pane) => pane.tabs.map((tab) => tab.tabId)));
    // No `label` known (either this window's structure hasn't arrived yet,
    // or a tab its structure doesn't know about yet) -> `null`, the same
    // positional numbering as elsewhere as the sole anchor.
    const looseRows: TabUsageRow[] = windowSamples
      .filter((sample) => !groupedTabIds.has(sample.tabId))
      .map((sample, index) => ({ ...sample, number: index + 1, label: null }))
      .sort((a, b) => dominantPercent(b) - dominantPercent(a));
    // Over ALL of this window's samples, not just `looseRows` — otherwise a
    // window whose heaviest consumer just moved into a pane group would
    // wrongly sink in the window ordering.
    const topPercent = windowSamples.reduce((max, sample) => Math.max(max, dominantPercent(sample)), -Infinity);
    otherGroups.push({
      group: {
        windowLabel,
        windowTitle: titleFor(windowLabel),
        panes: panesForWindow,
        tabs: looseRows,
      },
      topPercent,
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
