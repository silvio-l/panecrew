import { Dialog } from "radix-ui";
import { useTranslation } from "react-i18next";
import { formatChord, SHORTCUTS } from "../shortcuts/registry";
import type { ShortcutDefinition } from "../shortcuts/registry";
import { isMacPlatform } from "../shortcuts/platform";
import { CHROME_FOCUS_RING } from "./ChromeTooltip";

// Referenz-Editor-Menüaudit, letzter der zehn Punkte: dieselben Daten wie
// `docs/shortcuts.md` (`scripts/generate-shortcuts-docs.ts`), nur als Dialog
// statt als generierte Markdown-Datei — ein Nutzer, der die Kürzel-Referenz
// braucht, hat selten ein Terminal mit dem Repo-Checkout offen. `SHORTCUTS`
// bleibt die eine Quelle für beide; ändert sich ein Eintrag dort, ziehen
// Laufzeit-Erkennung, generierte Datei UND dieser Dialog gemeinsam nach.
export function ShortcutsReferenceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const platform = isMacPlatform() ? "mac" : "other";
  const appShortcuts = SHORTCUTS.filter((def) => def.scope === "app");
  const paneShortcuts = SHORTCUTS.filter((def) => def.scope === "pane");

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-(--pc-dialog-overlayBackground) animate-[pc-overlay-fade-in_150ms_ease-out]" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[min(32rem,calc(100vh-4rem))] w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-(--pc-widget-border) bg-(--pc-widget-background) p-5 shadow-lg outline-none animate-[pc-overlay-in_150ms_ease-out]"
          // Kein `Dialog.Description`: die Tabelle darunter ist die
          // Beschreibung. Explizit `undefined` statt der Prop einfach
          // wegzulassen unterdrückt Radix' Entwicklungs-Konsolenwarnung
          // ("Missing Description"), die sonst bei jedem Öffnen aufliefe.
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between gap-3">
            <Dialog.Title className="text-(length:--pc-chrome-fontSizeLarge) font-semibold text-(--pc-foreground)">
              {t("shortcutsReference.title")}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label={t("shortcutsReference.close")}
                className={`flex size-6 shrink-0 items-center justify-center rounded-md text-(--pc-descriptionForeground) transition-colors hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-foreground) ${CHROME_FOCUS_RING}`}
              >
                <CloseIcon />
              </button>
            </Dialog.Close>
          </div>

          <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
            <ShortcutGroup
              title={t("shortcutsReference.wholeInterface")}
              defs={appShortcuts}
              platform={platform}
            />
            <ShortcutGroup
              title={t("shortcutsReference.activePane")}
              defs={paneShortcuts}
              platform={platform}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ShortcutGroup({
  title,
  defs,
  platform,
}: {
  title: string;
  defs: readonly ShortcutDefinition[];
  platform: "mac" | "other";
}) {
  return (
    <div className="mb-4 last:mb-0">
      <h3 className="mb-1.5 text-(length:--pc-chrome-fontSize) font-semibold text-(--pc-descriptionForeground)">
        {title}
      </h3>
      <ul className="flex flex-col">
        {defs.map((def) => (
          <li
            key={def.id}
            className="flex items-center justify-between gap-4 rounded-sm px-1 py-1"
          >
            <span className="min-w-0 flex-1 truncate text-(length:--pc-chrome-fontSize) text-(--pc-foreground)">
              {def.description}
            </span>
            <span className="shrink-0 font-(family-name:--pc-terminal-fontFamily) text-(length:--pc-chrome-fontSize) text-(--pc-descriptionForeground)">
              {formatChord(def, platform)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Dasselbe Kreuz-Strichbild wie die übrigen Schließen-Knöpfe im Chrome (16er
// Box, 1.2 Strichstärke, runde Enden).
function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    >
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
    </svg>
  );
}
