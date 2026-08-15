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
