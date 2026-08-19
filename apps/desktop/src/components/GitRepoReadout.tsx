import { useTranslation } from "react-i18next";
import type { GitRepoSummary } from "../types/gitStatus";
import { HudReadout } from "./HudReadout";

// Branch/Dirty/Ahead-Behind/Worktree in einer Zeile — geteilt zwischen
// `GridStatusRail` (fokussierte Pane) und der Explorer-Kopfzeile (Ticket
// 02/03), beide gespeist aus demselben `explorer_git_status`-Aufruf
// (`loadProject.ts` → `project.gitRepo`).
//
// Bewusst NICHT vollständig über `HudReadout`: dessen eigene Regel ist
// „sichtbar sind nur Ziffern/Symbole, nie Prosa" — ein Branch-Name ist aber
// ein Bezeichner, keine Zahl. Nur die beiden Zähler (Dirty-Count,
// Ahead/Behind) nutzen das Register; der Name läuft in der normalen
// Chrome-Schrift, wie der Projektname im Explorer-Kopf.
export function GitRepoReadout({ summary }: { summary: GitRepoSummary }) {
  const { t } = useTranslation();
  const { branch, dirtyCount, worktree } = summary;
  const branchLabel = branch.detached
    ? t("gitRepo.detachedBranch")
    : (branch.name ?? t("gitRepo.detachedBranch"));

  return (
    <span className="flex min-w-0 items-center gap-2">
      <span
        className="min-w-0 truncate font-(family-name:--pc-terminal-fontFamily) text-(length:--pc-chrome-fontSizeSmall) text-(--pc-descriptionForeground)"
        title={
          worktree !== null
            ? t("gitRepo.worktreeBranch", {
                repo: worktree.mainRepoName,
                branch: branchLabel,
              })
            : branchLabel
        }
      >
        {worktree !== null
          ? t("gitRepo.worktreeBranch", {
              repo: worktree.mainRepoName,
              branch: branchLabel,
            })
          : branchLabel}
      </span>
      {dirtyCount > 0 && (
        <HudReadout
          glyph="●"
          value={String(dirtyCount)}
          srText={t("gitRepo.dirtyCount", { count: dirtyCount })}
        />
      )}
      {branch.ahead !== null && branch.ahead > 0 && (
        <HudReadout
          glyph="↑"
          value={String(branch.ahead)}
          srText={t("gitRepo.ahead", { count: branch.ahead })}
        />
      )}
      {branch.behind !== null && branch.behind > 0 && (
        <HudReadout
          glyph="↓"
          value={String(branch.behind)}
          srText={t("gitRepo.behind", { count: branch.behind })}
        />
      )}
    </span>
  );
}
