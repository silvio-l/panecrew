import { Fragment, type ReactElement } from "react";
import { Tooltip } from "radix-ui";
import { useTranslation } from "react-i18next";
import { formatMemoryBytes, type PaneUsageGroup, type TabUsageRow } from "../terminal/resourceUsageTree";
import { useTabResourceGuard } from "../terminal/resourceGuard";

// Dieselbe Radix-Root/Trigger/Portal/Content-Struktur und dieselben
// Chrome-Popup-Tokens wie `ChromeTooltip.tsx` (dessen Content dort ist
// ausdrücklich auf einen einzeiligen `string` typisiert — für die
// Pane→Tab-Baumansicht hier reicht das nicht, deshalb eine eigene, kleine
// Fassung statt den geteilten Baustein zu verbiegen). `ChromeTooltip` bleibt
// unverändert für jeden anderen Aufrufer.

const GUARD_STATUS_COLOR: Record<ReturnType<typeof useTabResourceGuard>["status"], string> = {
  normal: "text-(--pc-descriptionForeground)",
  warn: "text-(--pc-status-warn)",
  // Ein pausierter Tab hat die harte Schwelle bereits gerissen (Prozess
  // eingefroren), ein terminierter noch mehr — beide teilen sich dieselbe
  // "kritisch"-Farbe wie die App-weite Anzeige (`RESOURCE_STATUS_COLOR`
  // dort), es gibt in diesem Popover keine feinere Abstufung dafür.
  // Getragen wird die Farbe von den beiden Prozentwerten einer Zeile (dort
  // sitzen die Schwellen der Eskalationskette) — der absolute Bytewert
  // daneben bleibt bewusst neutral, damit ein Warn-/Danger-Ausschlag als
  // klarer Ausreißer lesbar ist statt als durchgefärbte Zeile.
  paused: "text-(--pc-status-danger)",
  terminated: "text-(--pc-status-danger)",
};

// Dasselbe "Terminal-Register" wie die RAM/CPU-Kurzanzeige in der Titelleiste
// (`ResourceUsageReadout`, TitleBar.tsx): Monospace + tabular-nums, damit die
// Zahlen des Popovers typografisch als dieselbe Instrumentenanzeige lesbar
// sind wie ihr Auslöser — und in der Werte-Spalte Ziffer unter Ziffer stehen.
const VALUE_REGISTER_CLASS =
  "justify-self-end whitespace-nowrap font-(family-name:--pc-terminal-fontFamily) text-[11px] leading-none tracking-[0.04em] tabular-nums";

// Mikro-Beschriftung im Chrome-Stil (Spaltenköpfe RAM/CPU, Pane-Namen):
// kleiner, versal, gesperrt — ein eigenes Register unterhalb der Tab-Zeilen,
// damit Struktur-Beschriftung und Inhalt nie um Aufmerksamkeit konkurrieren.
const MICRO_LABEL_CLASS = "text-[10px] uppercase tracking-[0.08em] text-(--pc-descriptionForeground)";

/**
 * Titelleisten-Ressourcen-Popover: dieselbe Kurzfassung ("RAM x % · CPU y %")
 * wie bisher als Kopfzeile, darunter — sofern mindestens ein Tab schon eine
 * erste Stichprobe hat — die Pane→Tab-Baumansicht (`resourceUsageTree.ts`
 * gruppiert/sortiert bereits fertig). Jede Tab-Zeile liest ihre Farbe live
 * aus `resourceGuard.ts` (derselbe Zustand wie der Warn-Chip am Tab selbst,
 * `PaneTabs.tsx`) statt eine zweite Schwellenlogik zu duplizieren.
 *
 * Layout: EIN gemeinsames Grid über alle Gruppen (Name | RAM | CPU) statt
 * `justify-between` pro Zeile — nur so stehen die Werte auch bei
 * unterschiedlich langen Tab-Namen gruppenübergreifend in einer Flucht.
 * Die Spaltenköpfe stehen deshalb einmal über dem ganzen Baum, nicht pro
 * Gruppe; Gruppen trennt die hauchdünne `--pc-titleBar-border`-Linie
 * (dieselbe 1px-Trennergrammatik wie überall im Chrome, keine Boxen).
 * Die `sr-only`-Zeilentexte stehen als absolut positionierte Geschwister mit
 * im Grid — absolut positionierte Kinder eines Grid-Containers nehmen laut
 * Spec nicht an der Spurbildung teil, verschieben also keine Zellen.
 */
export function ResourceUsageTreeTooltip({
  summary,
  groups,
  children,
}: {
  summary: string;
  groups: readonly PaneUsageGroup[];
  children: ReactElement;
}) {
  const { t } = useTranslation();
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="bottom"
          align="end"
          sideOffset={4}
          className="z-20 max-w-80 rounded-md border border-(--pc-titleBar-border) bg-(--pc-explorer-background) px-2.5 py-2 text-(length:--pc-chrome-fontSizeSmall) text-(--pc-foreground) shadow-lg data-[state=closed]:animate-[pc-overlay-out_150ms_ease-in] data-[state=delayed-open]:animate-[pc-overlay-in_150ms_ease-out] data-[state=instant-open]:animate-[pc-overlay-in_150ms_ease-out]"
        >
          <div className="tabular-nums">{summary}</div>
          {groups.length > 0 && (
            <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-1 border-t border-(--pc-titleBar-border) pt-2">
              <span aria-hidden="true" />
              <span aria-hidden="true" className={`justify-self-end ${MICRO_LABEL_CLASS}`}>
                {t("titleBar.resourceUsage.columnMem")}
              </span>
              <span aria-hidden="true" className={`justify-self-end ${MICRO_LABEL_CLASS}`}>
                {t("titleBar.resourceUsage.columnCpu")}
              </span>
              {groups.map((group, index) => (
                <PaneUsageGroupRows key={group.paneId} group={group} first={index === 0} />
              ))}
            </div>
          )}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function PaneUsageGroupRows({ group, first }: { group: PaneUsageGroup; first: boolean }) {
  return (
    <Fragment>
      <span
        className={`col-span-3 min-w-0 truncate ${MICRO_LABEL_CLASS} ${
          first ? "" : "mt-1 border-t border-(--pc-titleBar-border) pt-2"
        }`}
      >
        {group.projectName}
      </span>
      {group.tabs.map((row) => (
        <TabUsageRowLine key={row.tabId} row={row} />
      ))}
    </Fragment>
  );
}

function TabUsageRowLine({ row }: { row: TabUsageRow }) {
  const { t } = useTranslation();
  const { status } = useTabResourceGuard(row.tabId);
  const name = row.label ?? t("paneTabs.terminalTab", { number: row.number });
  const memPercent = Math.round(row.memPercent);
  const cpuPercent = Math.round(row.cpuPercent);
  const memBytes = formatMemoryBytes(row.memBytes);

  return (
    <Fragment>
      <span aria-hidden="true" className="min-w-0 truncate pl-2">
        {name}
      </span>
      <span aria-hidden="true" className={VALUE_REGISTER_CLASS}>
        <span className={GUARD_STATUS_COLOR[status]}>{memPercent}&nbsp;%</span>
        <span className="text-(--pc-descriptionForeground)"> · {memBytes}</span>
      </span>
      <span aria-hidden="true" className={`${VALUE_REGISTER_CLASS} ${GUARD_STATUS_COLOR[status]}`}>
        {cpuPercent}&nbsp;%
      </span>
      <span className="sr-only">
        {t("titleBar.resourceUsage.perTabRow", { name, mem: memPercent, memBytes, cpu: cpuPercent })}
      </span>
    </Fragment>
  );
}
