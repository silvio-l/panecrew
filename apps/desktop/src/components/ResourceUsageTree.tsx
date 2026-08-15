import type { ReactElement } from "react";
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
  paused: "text-(--pc-status-danger)",
  terminated: "text-(--pc-status-danger)",
};

/**
 * Titelleisten-Ressourcen-Popover: dieselbe Kurzfassung ("RAM x % · CPU y %")
 * wie bisher als Kopfzeile, darunter — sofern mindestens ein Tab schon eine
 * erste Stichprobe hat — die Pane→Tab-Baumansicht (`resourceUsageTree.ts`
 * gruppiert/sortiert bereits fertig). Jede Tab-Zeile liest ihre Farbe live
 * aus `resourceGuard.ts` (derselbe Zustand wie der Warn-Chip am Tab selbst,
 * `PaneTabs.tsx`) statt eine zweite Schwellenlogik zu duplizieren.
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
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="bottom"
          align="end"
          sideOffset={4}
          className="z-20 max-w-72 rounded-md border border-(--pc-titleBar-border) bg-(--pc-explorer-background) px-2 py-1.5 text-(length:--pc-chrome-fontSizeSmall) text-(--pc-foreground) shadow-lg data-[state=closed]:animate-[pc-overlay-out_150ms_ease-in] data-[state=delayed-open]:animate-[pc-overlay-in_150ms_ease-out] data-[state=instant-open]:animate-[pc-overlay-in_150ms_ease-out]"
        >
          <div>{summary}</div>
          {groups.length > 0 && (
            <div className="mt-1.5 flex flex-col gap-1.5 border-t border-(--pc-titleBar-border) pt-1.5">
              {groups.map((group) => (
                <PaneUsageGroupRows key={group.paneId} group={group} />
              ))}
            </div>
          )}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function PaneUsageGroupRows({ group }: { group: PaneUsageGroup }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="truncate text-(--pc-descriptionForeground)">{group.projectName}</span>
      <div className="flex flex-col gap-0.5 pl-2">
        {group.tabs.map((row) => (
          <TabUsageRowLine key={row.tabId} row={row} />
        ))}
      </div>
    </div>
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
    <div className="flex items-center justify-between gap-2 tabular-nums">
      <span aria-hidden="true" className="truncate">
        {name}
      </span>
      <span aria-hidden="true" className={`shrink-0 leading-none ${GUARD_STATUS_COLOR[status]}`}>
        {memPercent}&nbsp;% ({memBytes}) · {cpuPercent}&nbsp;%
      </span>
      <span className="sr-only">
        {t("titleBar.resourceUsage.perTabRow", { name, mem: memPercent, memBytes, cpu: cpuPercent })}
      </span>
    </div>
  );
}
