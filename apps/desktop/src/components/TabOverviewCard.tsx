import { useState, type ReactElement, type ReactNode } from "react";
import { HoverCard } from "radix-ui";
import { useTranslation } from "react-i18next";
import type { GitRepoSummary } from "../types/gitStatus";
import { GitRepoReadout } from "./GitRepoReadout";

export interface TabOverviewProject {
  name: string;
  path: string;
  gitRepo: GitRepoSummary | null;
}

interface TabOverviewCardProps {
  title: string;
  kindLabel: string;
  detailLabel: string;
  detail: ReactNode;
  path: string;
  project: TabOverviewProject;
  status?: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  children: ReactElement;
}

/**
 * A compact, read-only index card for a tab. The project and repository rows
 * deliberately reuse the same cached data as the Explorer and status rail;
 * opening this card never performs an extra filesystem or git read.
 */
export function TabOverviewCard({
  title,
  kindLabel,
  detailLabel,
  detail,
  path,
  project,
  status,
  hint,
  disabled = false,
  children,
}: TabOverviewCardProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <HoverCard.Root
      // Keep the trigger subtree mounted while a pointer drag is in progress.
      // Replacing it would release pointer capture and abort the tab move.
      open={disabled ? false : open}
      onOpenChange={(nextOpen) => setOpen(disabled ? false : nextOpen)}
      openDelay={350}
      closeDelay={120}
    >
      <HoverCard.Trigger asChild onPointerDown={() => setOpen(false)}>
        {children}
      </HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          role="dialog"
          aria-label={t("paneTabs.overviewLabel", { name: title })}
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="relative z-40 w-72 select-text overflow-hidden rounded-lg border border-(--pc-widget-border) bg-(--pc-widget-background) text-(length:--pc-chrome-fontSizeSmall) text-(--pc-foreground) shadow-[var(--pc-lift-elevation)] outline-none data-[state=open]:animate-[pc-overlay-in_150ms_ease-out] data-[state=closed]:animate-[pc-overlay-out_150ms_ease-in]"
        >
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 w-px bg-(--pc-pane-activeBorder)/70"
          />
          <div className="flex items-start justify-between gap-3 border-b border-(--pc-widget-border) px-3.5 py-3">
            <div className="min-w-0">
              <div className="truncate text-(length:--pc-chrome-fontSize) font-semibold">
                {title}
              </div>
              <div className="mt-0.5 text-(--pc-descriptionForeground)">{kindLabel}</div>
            </div>
            {status !== undefined && (
              <span className="shrink-0 rounded-full border border-(--pc-pane-activeBorder)/45 bg-(--pc-pane-activeBorder)/10 px-2 py-0.5 text-[10px] font-medium text-(--pc-paneHeader-activeForeground)">
                {status}
              </span>
            )}
          </div>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 px-3.5 py-3">
            <OverviewTerm>{detailLabel}</OverviewTerm>
            <OverviewDescription>{detail}</OverviewDescription>

            <OverviewTerm>{t("paneTabs.overviewProject")}</OverviewTerm>
            <OverviewDescription>{project.name}</OverviewDescription>

            <OverviewTerm>{t("paneTabs.overviewPath")}</OverviewTerm>
            <OverviewDescription terminal title={path}>
              {path}
            </OverviewDescription>

            {project.gitRepo !== null && (
              <>
                <OverviewTerm>{t("paneTabs.overviewRepository")}</OverviewTerm>
                <OverviewDescription>
                  <GitRepoReadout summary={project.gitRepo} />
                </OverviewDescription>
              </>
            )}
          </dl>
          {hint !== undefined && (
            <div className="border-t border-(--pc-widget-border) px-3.5 py-2 font-(family-name:--pc-terminal-fontFamily) text-[10px] text-(--pc-descriptionForeground)">
              {hint}
            </div>
          )}
          <HoverCard.Arrow className="fill-(--pc-widget-background) stroke-(--pc-widget-border)" />
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}

function OverviewTerm({ children }: { children: ReactNode }) {
  return <dt className="text-(--pc-descriptionForeground)">{children}</dt>;
}

function OverviewDescription({
  children,
  terminal = false,
  title,
}: {
  children: ReactNode;
  terminal?: boolean;
  title?: string;
}) {
  return (
    <dd
      title={title}
      className={`min-w-0 truncate ${
        terminal ? "font-(family-name:--pc-terminal-fontFamily)" : "font-medium"
      }`}
    >
      {children}
    </dd>
  );
}
