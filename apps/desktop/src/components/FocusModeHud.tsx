import { useTranslation } from "react-i18next";
import type { FocusRotation } from "../grid/useFocusRotation";
import { CHROME_FOCUS_RING, ChromeTooltip } from "./ChromeTooltip";

// Rotations-Cluster des Fokus-Modus (Ticket 19) — sitzt IM Pane-Header
// (TerminalPane.tsx/FileEditor.tsx, zwischen Tab-Leiste und
// Fokus-Modus-Knopf), nicht mehr als eigene, frei über dem Inhalt
// schwebende Fläche. Frühere Fassung lag `absolute top-2 left-2` über dem
// Terminal-Text selbst — bei aktivem Output kollidierte das sichtbar mit
// echtem Inhalt und wirkte, je nach Scroll-/Textstand darunter, "irgendwo
// aufgeklebt" (Nutzer-Feedback 2026-08-13: "hängt komisch drüber"). Der
// Header ist dagegen die längst etablierte, IMMER an derselben Stelle
// stehende Instrumentenzeile jeder Pane (Prompt-Chevron, Name, Tab-Leiste,
// Fokus-/Schließen-Knopf) — zusätzliche Instrumente reihen sich dort ein,
// statt eine zweite, freischwebende Fläche zu eröffnen; eine eigene
// Drag-und-Drop-Positionierung (die andere vom Nutzer angebotene Option)
// bräuchte einen persistenten Ablageort und wäre die einzige frei bewegliche
// Fläche der ganzen App — Bruch mit dem sonst überall starren HUD-Vokabular.
// Ohne eigene Bracket-Rahmung mehr (der Header selbst ist der Rahmen) und
// ohne die gedimmte `.pc-hud-readout`-Färbung: die ist für HOVER-enthüllte
// Leseflächen gedacht (ProjectPicker.tsx) und unterschritt hier, wo der Wert
// dauerhaft sichtbar und aktiv gelesen wird, WCAG (Nutzer-Feedback) — Text
// läuft deshalb über dieselben `--pc-paneHeader-activeForeground`-Token wie
// der Rest des Headers (maximiert ⇒ immer auch fokussiert, gridState.ts'
// `enterFocusMode` setzt beides gemeinsam).
export function FocusModeHud({
  slotNumber,
  totalSlots,
  rotation,
}: {
  /** 1-basiert — dieselbe Zahl wie der Zahlen-Hotkey, der diese Pane im
   * Fokus-Modus direkt anwählt. */
  slotNumber: number;
  totalSlots: number;
  rotation: FocusRotation;
}) {
  const { t } = useTranslation();
  const seconds = Math.round(rotation.intervalMs / 1000);

  return (
    <div className="flex shrink-0 items-center gap-1">
      {/* Slot-Position — reiner Lesewert, kein Knopf: welche Zahl gerade
          zieht, verrät bereits die maximierte Pane selbst. */}
      <span
        className="px-1 font-(family-name:--pc-terminal-fontFamily) text-[10px] tracking-[0.2em] text-(--pc-paneHeader-activeForeground)"
        aria-label={t("focusMode.positionAria", {
          slot: slotNumber,
          total: totalSlots,
        })}
      >
        {slotNumber}/{totalSlots}
      </span>
      <span aria-hidden="true" className="h-3 w-px bg-(--pc-pane-activeBorder)/45" />
      <ChromeTooltip
        label={t(rotation.active ? "focusMode.rotationStop" : "focusMode.rotationStart")}
      >
        <button
          type="button"
          aria-label={t(rotation.active ? "focusMode.rotationStop" : "focusMode.rotationStart")}
          aria-pressed={rotation.active}
          onClick={rotation.toggle}
          className={`flex size-(--pc-paneControl-size) shrink-0 items-center justify-center rounded-(--pc-paneControl-radius) text-(--pc-paneHeader-activeForeground) transition-colors hover:bg-(--pc-list-hoverBackground) ${CHROME_FOCUS_RING}`}
        >
          {/* Echtes Play-/Pause-Piktogramm statt eines reinen Statuspunkts
              (Nutzer-Feedback 2026-08-13) — dieselbe Player-Konvention wie
              überall sonst: läuft die Rotation (Play-Zustand), zeigt der
              Knopf das Pause-Symbol (die Handlung, die ein Klick auslöst),
              und umgekehrt. `currentColor` statt eigener Füllfarbe, folgt
              also automatisch Hover/Fokus wie jedes andere Header-Icon. */}
          {rotation.active ? <PauseGlyph /> : <PlayGlyph />}
        </button>
      </ChromeTooltip>
      <ChromeTooltip label={t("focusMode.intervalAria", { seconds })}>
        <button
          type="button"
          aria-label={t("focusMode.intervalAria", { seconds })}
          onClick={rotation.cycleInterval}
          className={`rounded-(--pc-paneControl-radius) px-1 py-0.5 font-(family-name:--pc-terminal-fontFamily) text-[10px] tracking-[0.2em] text-(--pc-paneHeader-activeForeground) transition-colors hover:bg-(--pc-list-hoverBackground) ${CHROME_FOCUS_RING}`}
        >
          {seconds}s
        </button>
      </ChromeTooltip>
    </div>
  );
}

function PlayGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 10 10" width="10" height="10" fill="currentColor">
      <path d="M2.5 1.2 8.5 5 2.5 8.8Z" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 10 10" width="10" height="10" fill="currentColor">
      <rect x="2" y="1.3" width="2.2" height="7.4" />
      <rect x="5.8" y="1.3" width="2.2" height="7.4" />
    </svg>
  );
}
