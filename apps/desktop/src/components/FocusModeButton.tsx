import { useTranslation } from "react-i18next";
import { CHROME_FOCUS_RING, ChromeTooltip } from "./ChromeTooltip";

// Der eine Maximieren/Verlassen-Knopf des Fokus-Modus (Ticket 19) —
// TerminalPane.tsx UND FileEditor.tsx binden ihn identisch in ihren
// jeweiligen Drei-Zonen-Header ein (dieselbe Stelle vor dem Schließen-Kreuz,
// dieselbe Hover-Reveal-Mechanik), damit ein Tab-Wechsel innerhalb einer Pane
// nie den Knopf springen lässt. Eine Komponente statt zwei Kopien, weil
// beide Header exakt dasselbe Steuerelement mit exakt derselben Bedeutung
// zeigen — zwei Kopien liefen bei der nächsten Iconänderung auseinander.
export function FocusModeButton({
  maximized,
  onToggle,
}: {
  /** Ob GENAU DIESE Pane gerade den Fokus-Modus trägt — bestimmt Icon UND
   * Tooltip-Text (Verlassen statt Maximieren). */
  maximized: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const label = t(
    maximized ? "terminalPane.exitFocusMode" : "terminalPane.enterFocusMode",
  );
  return (
    <ChromeTooltip label={label} align="end">
      <button
        type="button"
        aria-label={label}
        aria-pressed={maximized}
        onClick={onToggle}
        // Dieselbe Hover-Sprache wie der Schließen-Knopf daneben: gedimmt bis
        // Hover/Fokus, dann voller Vordergrund — nie der Akzent, der bleibt
        // laut Direction Contract exklusiv dem Fokus-Rahmen vorbehalten.
        className={`flex size-(--pc-paneControl-size) shrink-0 items-center justify-center rounded-(--pc-paneControl-radius) text-(--pc-paneHeader-foreground) opacity-0 transition-[opacity,color,background-color] hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-foreground) focus-visible:opacity-100 group-hover/pane:opacity-100 ${CHROME_FOCUS_RING}`}
      >
        {maximized ? <CollapseIcon /> : <ExpandIcon />}
      </button>
    </ChromeTooltip>
  );
}

// Vier Pfeile nach außen — dieselbe 12er-viewBox und 1.2-Strichstärke wie
// TerminalPane.tsx' CloseIcon daneben, damit beide Knöpfe optisch gleich
// schwer wirken.
function ExpandIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1.5 4.5v-3h3M10.5 4.5v-3h-3M1.5 7.5v3h3M10.5 7.5v3h-3" />
    </svg>
  );
}

// Vier Pfeile nach innen — die Umkehrung, gleiche Eckpunkte gespiegelt.
function CollapseIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4.5 1.5v3h-3M7.5 1.5v3h3M4.5 10.5v-3h-3M7.5 10.5v-3h3" />
    </svg>
  );
}
