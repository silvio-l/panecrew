// Der nicht-blockierende Update-Hinweis im Hauptfenster (docs/decisions.md →
// "Auto-Update via GitHub Releases", Punkt 3). Rendert sich selbst weg,
// solange nichts zu tun ist — "geprüft, aktuell" bekommt hier bewusst KEINE
// Meldung, das bliebe dem manuellen Weg im Über-Fenster vorbehalten, sonst
// stünde bei jedem App-Start ein Toast, den niemand angefordert hat.
import { useEffect, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Trans, useTranslation } from "react-i18next";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { recordAutoCheckAttempt, shouldAutoCheck } from "./updateManager";
import { useUpdateFlow } from "./useUpdateFlow";

export function UpdateBanner() {
  const { t } = useTranslation();
  const [version, setVersion] = useState<string | null>(null);
  const { state, check, installAndRestart, confirmRestart, dismiss } =
    useUpdateFlow(version);

  useEffect(() => {
    // Ohne `.catch()` bliebe ein Fehlschlag (z. B. außerhalb einer echten
    // Tauri-Laufzeit, etwa in Tests, die diesen Banner über App.tsx
    // mitrendern) eine unhandled rejection — die Version bleibt dann einfach
    // `null`, das ist bereits der erwartete "noch nicht geladen"-Zustand.
    getVersion()
      .then(setVersion)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!shouldAutoCheck()) return;
    recordAutoCheckAttempt();
    void check();
    // Nur beim allerersten Mount des Hauptfensters relevant — `check` selbst
    // ändert sich pro Version zwar, soll die Drosselung aber nicht erneut
    // auslösen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state.phase === "confirmRestart") {
    return (
      <ConfirmDialog
        title={t("updater.restartTitle")}
        description={
          <Trans
            i18nKey="updater.restartDescription"
            values={{ version: state.update.version }}
            components={{
              bold: <span className="font-medium text-(--pc-foreground)" />,
            }}
          />
        }
        confirmLabel={t("updater.restartConfirm")}
        cancelLabel={t("updater.restartLater")}
        onConfirm={confirmRestart}
        onClose={dismiss}
      />
    );
  }

  if (state.phase === "available") {
    return (
      <Banner>
        <span className="text-(--pc-foreground)">
          {t("updater.available", { version: state.update.version })}
        </span>
        <div className="flex items-center gap-3">
          <BannerButton onClick={() => installAndRestart(state.update)}>
            {t("updater.installAndRestart")}
          </BannerButton>
          <QuietBannerButton onClick={dismiss}>
            {t("updater.later")}
          </QuietBannerButton>
        </div>
      </Banner>
    );
  }

  if (state.phase === "downloading") {
    return (
      <Banner>
        <span className="text-(--pc-foreground)">
          {state.percent === null
            ? t("updater.downloading")
            : t("updater.downloadingPercent", { percent: state.percent })}
        </span>
      </Banner>
    );
  }

  if (state.phase === "installError") {
    return (
      <Banner>
        <span className="text-(--pc-foreground)">{t("updater.error")}</span>
        <div className="flex items-center gap-3">
          <BannerButton onClick={() => installAndRestart(state.update)}>
            {t("updater.retry")}
          </BannerButton>
          <QuietBannerButton onClick={dismiss}>
            {t("updater.dismiss")}
          </QuietBannerButton>
        </div>
      </Banner>
    );
  }

  // Ein fehlgeschlagener Hintergrund-Check (z. B. kein Netz beim Start)
  // verdient keinen Toast — dieselbe Zurückhaltung wie beim "current"-Zustand
  // oben (Kommentarkopf dieser Datei). Der manuelle Weg im Über-Fenster zeigt
  // ihn sichtbar an, hier bliebe er sonst unbeantwortbarer Lärm bei jedem
  // Start ohne Verbindung.
  if (state.phase === "checkError") {
    return null;
  }

  return null;
}

// Feste Position statt Flow-Element: die Grid-Statuszeile daneben soll sich
// nicht verschieben, nur weil zufällig ein Update ansteht. z-20 — über dem
// Inhalt der Panes, aber unter Kontextmenü (z-30) und Rückfrage (z-40/50):
// eine Rückfrage MUSS die Bestätigung dieses Banners jederzeit überdecken
// können.
function Banner({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="fixed bottom-3 right-3 z-20 flex items-center gap-4 rounded-md border border-(--pc-widget-border) bg-(--pc-widget-background) px-3.5 py-2.5 text-(length:--pc-chrome-fontSize) shadow-lg"
    >
      {children}
    </div>
  );
}

function BannerButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-7 shrink-0 items-center rounded-md border border-(--pc-widget-border) bg-(--pc-list-activeSelectionBackground) px-3 text-(length:--pc-chrome-fontSize) font-medium text-(--pc-foreground) transition-colors hover:bg-(--pc-list-hoverBackground) focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-(--pc-focusBorder)"
    >
      {children}
    </button>
  );
}

function QuietBannerButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-sm text-(length:--pc-chrome-fontSize) text-(--pc-descriptionForeground) underline decoration-current/35 underline-offset-3 transition-colors hover:text-(--pc-foreground) focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-(--pc-focusBorder)"
    >
      {children}
    </button>
  );
}
