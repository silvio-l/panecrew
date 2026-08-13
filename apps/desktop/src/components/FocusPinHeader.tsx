import { useTranslation } from "react-i18next";
import { CHROME_FOCUS_RING, ChromeTooltip } from "./ChromeTooltip";

// Pin-Header "J1" (PCB-Metapher, s. FocusTrace.tsx): ein vertikaler
// Steckverbinder an der Naht zwischen Explorer und Grid — ein quadratisches
// Pad pro tatsächlich offener Pane (dynamisch nach `gridState.slots`, nicht
// immer 4), das bestromte amber gefüllt, die übrigen als Kupfer-Umriss in den
// bestehenden Rahmen-Tokens. Die Pins sind FUNKTIONAL, kein Deko-Element:
// Klick (und Tastatur — echte `<button>`s statt role="button", Enter/Space
// kommen damit vom Browser selbst) fokussiert die jeweilige Pane, ein echter
// zusätzlicher Fokusweg neben Pane-Klick und Kürzeln.
//
// Sitzt als eigenes, layoutneutrales Element (w-0) NEBEN dem
// `role="separator"`-Resize-Griff (App.tsx) statt als dessen Umbau — der
// behält seine Resize-Funktion unverändert; die Pins liegen mit z-20 über
// seinen 5px (z-10) und nehmen ihm nur ihre eigene Trefferfläche. Der
// startende Punkt der Leiterbahn wird zur Laufzeit über `data-pin-pane-id`
// gemessen (FocusTrace.tsx), das Gegenstück zur `data-pane-id`-Konvention
// der Panes.

export interface FocusPin {
  paneId: string;
  /** 1-basiert, dieselbe Zählung wie `ProjectPicker`/`FocusModeHud` und die
   * Zahlen-Hotkeys im Fokus-Modus. */
  slotNumber: number;
  projectName: string;
}

export function FocusPinHeader({
  pins,
  focusedPaneId,
  onFocusPane,
}: {
  pins: readonly FocusPin[];
  focusedPaneId: string | null;
  onFocusPane: (paneId: string) => void;
}) {
  const { t } = useTranslation();
  if (pins.length === 0) return null;
  return (
    <div className="relative z-20 w-0 shrink-0">
      {/* Mittig auf der Naht: der Separator ist 5px breit mit -ml-[3px], die
          Nahtlinie liegt damit ~2px links der Flussposition dieses
          Nullbreiten-Elements. */}
      <div
        role="group"
        aria-label={t("pinHeader.groupLabel")}
        className="absolute top-1/2 left-[-2px] flex -translate-x-1/2 -translate-y-1/2 flex-col gap-1.5"
      >
        {pins.map((pin) => {
          const powered = pin.paneId === focusedPaneId;
          const label = t("pinHeader.focusPane", {
            number: pin.slotNumber,
            projectName: pin.projectName,
          });
          return (
            <ChromeTooltip key={pin.paneId} label={label} side="right">
              <button
                type="button"
                aria-label={label}
                aria-pressed={powered}
                data-pin-pane-id={pin.paneId}
                onClick={() => onFocusPane(pin.paneId)}
                // 16px Trefferfläche um ein 8px-Pad — das Pad selbst bleibt
                // in Steckverbinder-Proportion, der Knopf hält die
                // Mindest-Zielgröße. Eigener App-Grund hinter dem
                // Kupfer-Umriss, damit der Explorer-Rand nicht durch das
                // offene Pad läuft.
                className={`group/pin flex size-4 items-center justify-center ${CHROME_FOCUS_RING}`}
              >
                <span
                  aria-hidden="true"
                  // Quadratisch, bewusst ohne Rundung: Pads einer Platine,
                  // nicht Punkte. Amber gefüllt = bestromt (dasselbe Token
                  // wie Fokus-Rahmen und Leiterbahn); Hover auf den
                  // unbestromten zieht den Umriss in den Akzent — Amber als
                  // Einladung, dieselbe Semantik wie die Sucher-Ecken der
                  // leeren Slots (App.css).
                  className={`size-2 transition-colors ${
                    powered
                      ? "bg-(--pc-pane-activeBorder)"
                      : "border border-(--pc-pane-border) bg-(--pc-app-background) group-hover/pin:border-(--pc-pane-activeBorder)"
                  }`}
                />
              </button>
            </ChromeTooltip>
          );
        })}
      </div>
    </div>
  );
}
