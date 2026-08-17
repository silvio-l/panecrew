import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CHROME_FOCUS_RING } from "./ChromeTooltip";

// Shared by `SettingsWindow.tsx` (Help category) and the onboarding wizard's
// Permissions step — same explainer, same deep link, same button shape, so a
// user who saw this once in the wizard recognizes it later in Settings
// instead of it looking like a second, different feature.
//
// Only Full Disk Access is linked, deliberately down from an earlier
// three-link version (Full Disk Access, Files and Folders, bare Privacy &
// Security overview): confirmed live (2026-08-17, direct user testing) that
// the other two anchors just land on the general Privacy & Security
// overview pane with nothing PaneCrew-relevant visible there — dead ends
// that only added confusion. `url` is a `x-apple.systempreferences:` scheme,
// scoped in `capabilities/settings.json` (the plugin-opener default scope
// only covers mailto/tel/http/https — this needed its own explicit scope
// entry for the systempreferences scheme).
export function PermissionsSection({
  t,
}: {
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [openError, setOpenError] = useState(false);
  const open = (url: string) => {
    setOpenError(false);
    void openUrl(url).catch((error: unknown) => {
      console.error("PaneCrew: Systemeinstellungen konnten nicht geöffnet werden", error);
      setOpenError(true);
    });
  };

  return (
    <div>
      <p className="text-(length:--pc-chrome-fontSize) text-(--pc-foreground)">
        {t("settings.help.permissions.title")}
      </p>
      <p className="mt-0.5 max-w-md text-(length:--pc-chrome-fontSizeSmall) text-(--pc-descriptionForeground)">
        {t("settings.help.permissions.explainer")}
      </p>
      {openError && (
        <p className="mt-1 text-(length:--pc-chrome-fontSizeSmall) text-(--pc-descriptionForeground)">
          {t("settings.loadError")}
        </p>
      )}
      <div className="mt-2 flex flex-col items-start gap-1.5">
        <PermissionsLinkButton
          label={t("settings.help.permissions.fullDiskAccess")}
          onClick={() =>
            open("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")
          }
        />
      </div>
    </div>
  );
}

function PermissionsLinkButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-sm border border-(--pc-widget-border) px-3 py-1 text-(length:--pc-chrome-fontSizeSmall) text-(--pc-descriptionForeground) transition-colors hover:text-(--pc-foreground) ${CHROME_FOCUS_RING}`}
    >
      {label} →
    </button>
  );
}
