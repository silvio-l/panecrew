import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { CHROME_FOCUS_RING } from "./ChromeTooltip";
import { disposeResourceGuardEntry, useTabResourceGuard } from "../terminal/resourceGuard";

// UI-Seite der Pro-Tab-Ressourcen-Eskalationskette (`resource_guard.rs`).
// Bewusst eine EIGENE, von `TerminalPane.tsx`/`usePtyTerminal.ts` unabhängige
// Komponente (Koordinationsentscheidung während einer parallelen aktiven
// Bearbeitung von `usePtyTerminal.ts` in einer anderen Session) — sie liest
// nur `useTabResourceGuard(tabId)` (modul-globales Register, s.
// `resourceGuard.ts`) und bekommt die beiden einzigen Aktionen, die sie
// auslösen kann, als fertige Callbacks von ihrem Aufrufer gereicht, statt
// selbst etwas über Tab-/Pane-Lebenszyklus zu wissen.
//
// Rendert `null` in "normal"/"warn" — diese beiden Stufen zeigt allein der
// Tab-Chip (`PaneTabs.tsx`), diese Fläche hier beginnt erst bei "paused".

const SINGLE_KILL_NOTICE_MS = 2400;

export function TabResourceBanner({
  tabId,
  onTerminate,
  onRestart,
}: {
  tabId: string;
  /** Knopf "Beenden" im Pause-Banner — der Aufrufer (`TerminalPane.tsx`)
   * reicht den regulären, rückfragenden Tab-Schließen-Weg durch (oder, ist
   * dies der letzte Tab der Pane, den Pane-Schließen-Weg — `closeTerminalTab`
   * lehnt das Schließen des letzten Tabs sonst stillschweigend ab), keine
   * neue Schließ-Logik hier. */
  onTerminate: () => void;
  /** Knopf "Neu starten" im Terminated-Zustand — der Aufrufer (`App.tsx`s
   * `restartTerminatedTab`) öffnet ERST einen frischen Tab in derselben Pane
   * und schließt DANACH den toten ungefragt (kein Bestätigungsdialog: die
   * Sitzung ist bereits beendet, nichts geht dabei verloren), statt die alte
   * `tabId` wiederzubeleben. */
  onRestart: () => void;
}) {
  const { t } = useTranslation();
  const { status, percent, reason, singleKillNonce } = useTabResourceGuard(tabId);

  const [singleKillFlash, setSingleKillFlash] = useState(false);
  const flashTimer = useRef<number | null>(null);
  const mountedNonce = useRef(singleKillNonce);
  useEffect(() => {
    // Der erste Render nach einem Tab-Wechsel darf den zuletzt gesehenen
    // Nonce-Stand nicht als neues Ereignis missverstehen — nur ein
    // tatsächlicher Anstieg gegenüber dem zuletzt gesehenen Wert blitzt auf.
    if (singleKillNonce === mountedNonce.current) return;
    mountedNonce.current = singleKillNonce;
    setSingleKillFlash(true);
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(
      () => setSingleKillFlash(false),
      SINGLE_KILL_NOTICE_MS,
    );
  }, [singleKillNonce]);
  useEffect(
    () => () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    },
    [],
  );

  // Register-Leck vermeiden: `resourceGuard.ts`s `entries`-Map bekommt beim
  // ersten `useTabResourceGuard(tabId)`-Aufruf (hier UND in PaneTabs.tsx'
  // Chip) einen Eintrag, den nichts automatisch wieder löscht. Diese
  // Komponente ist pro Tab genau einmal gemountet und lebt exakt so lange
  // wie der Tab selbst (PaneGrid.tsx hält alle Terminal-Tabs einer Pane
  // gleichzeitig im DOM, nur unsichtbar) — ihr Unmount fällt also mit dem
  // tatsächlichen Verschwinden des Tabs zusammen, der natürliche Ort, den
  // Eintrag wieder freizugeben.
  useEffect(() => () => disposeResourceGuardEntry(tabId), [tabId]);

  const [resuming, setResuming] = useState(false);
  const handleResume = () => {
    setResuming(true);
    void invoke("resource_guard_resume", { tabId })
      .catch((error: unknown) => {
        console.error("PaneCrew: Fortsetzen der Tab-Ressourcen fehlgeschlagen", error);
      })
      .finally(() => setResuming(false));
  };

  return (
    <>
      {/* Transiente Meldung: EIN Prozess wurde gezielt beendet, der Tab lebt
          unverändert weiter — dieselbe Ecke/Chip-Sprache wie
          `TerminalPane.tsx`s Kopiert-Bestätigung, bewusst nicht als
          vollflächiges Banner, weil hier nichts pausiert oder eine Aktion
          verlangt. */}
      {/* `aria-live` statt `role="status"`: dieselbe Bildschirmleser-Ankündigung
          (role="status" bedeutet implizit genau `aria-live="polite"` +
          `aria-atomic`), aber ohne mit `TerminalPane.tsx`s eigener
          Kopiert-Bestätigungsregion um dieselbe Status-Rolle zu konkurrieren
          — zwei gleichzeitig gemountete `role="status"`-Regionen ließen sich
          sonst per Testing-Library/Screenreader nicht mehr auseinanderhalten. */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none absolute top-2 right-2 z-10"
      >
        {singleKillFlash && (
          <span className="flex items-center gap-1.5 rounded-(--pc-paneControl-radius) border border-(--pc-status-warn) bg-(--pc-pane-background)/90 px-2 py-1 font-(family-name:--pc-terminal-fontFamily) text-[10px] tracking-[0.25em] uppercase text-(--pc-foreground)">
            <span aria-hidden="true" className="text-(--pc-status-warn)">
              ▲
            </span>
            {t("resourceGuard.singleKillNotice", { percent: Math.round(percent) })}
          </span>
        )}
      </div>

      {(status === "paused" || status === "terminated") && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-(--pc-pane-background)/95 px-6">
          <div className="flex max-w-sm flex-col items-start gap-3 rounded-(--pc-paneControl-radius) border border-(--pc-status-danger) p-4">
            <p className="text-(length:--pc-chrome-fontSize) text-(--pc-foreground)">
              {status === "paused"
                ? t("resourceGuard.pausedMessage", { percent: Math.round(percent) })
                : reason === "manual-kill"
                  ? // Kein `{{percent}}` hier: anders als die anderen beiden
                    // Nachrichten oben geht ein manueller Kill (PaneTabs.tsx'
                    // Kontextmenü "Terminal hart beenden") nie auf einen
                    // Ressourcenwert zurück — `resource_guard.rs`s
                    // `resource_guard_kill_manual` meldet deshalb bewusst
                    // `percent: 0`, das hier zu zeigen wäre irreführend.
                    t("resourceGuard.manualKillMessage")
                  : t("resourceGuard.terminatedMessage", { percent: Math.round(percent) })}
            </p>
            <div className="flex gap-2">
              {status === "paused" ? (
                <>
                  <button
                    type="button"
                    disabled={resuming}
                    onClick={handleResume}
                    className={`flex h-7 items-center rounded-md border border-(--pc-pane-border) px-2.5 text-(length:--pc-chrome-fontSize) font-medium text-(--pc-foreground) transition-colors hover:bg-(--pc-list-hoverBackground) disabled:opacity-50 ${CHROME_FOCUS_RING}`}
                  >
                    {t("resourceGuard.resume")}
                  </button>
                  <button
                    type="button"
                    onClick={onTerminate}
                    className={`flex h-7 items-center rounded-md border border-(--pc-status-danger) px-2.5 text-(length:--pc-chrome-fontSize) font-medium text-(--pc-status-danger) transition-colors hover:bg-(--pc-list-hoverBackground) ${CHROME_FOCUS_RING}`}
                  >
                    {t("resourceGuard.terminateTab")}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={onRestart}
                  className={`flex h-7 items-center rounded-md border border-(--pc-pane-border) px-2.5 text-(length:--pc-chrome-fontSize) font-medium text-(--pc-foreground) transition-colors hover:bg-(--pc-list-hoverBackground) ${CHROME_FOCUS_RING}`}
                >
                  {t("resourceGuard.restart")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
