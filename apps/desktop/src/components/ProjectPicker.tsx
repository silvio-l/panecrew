// Ein LEERER SLOT im Grid — nicht mehr die frühere Leerdarstellung fürs ganze
// Fenster. Der Unterschied ist nicht bloß Größe: es können vier davon
// gleichzeitig auf dem Bildschirm stehen, und dann darf keiner davon eine
// Überschrift führen (vier <h1> in einem Quad) oder um Aufmerksamkeit rufen.
// Ein leerer Slot ist ein Angebot, keine Ansage.
//
// Die ganze Zelle ist der Knopf. Bei bis zu vier Zielen auf einem Bildschirm
// ist das der Unterschied zwischen "irgendwo ins leere Viertel klicken" und
// "ein 8x30-Rechteck treffen"; nebenbei entfällt der Knopf-im-Knopf, den ein
// zentriertes Bedienelement in einer klickbaren Fläche sonst ergäbe.
//
// Gestrichelte Hairline statt der durchgezogenen der Panes: dieselbe
// 1px-Grammatik, aber auf einen Blick als "hier ist noch nichts" lesbar —
// genau die Frage, die das Chrome laut Direction Contract beantworten darf.
import { CHROME_FOCUS_RING } from "./ChromeTooltip";

export function ProjectPicker({
  onChoose,
  busy,
}: {
  onChoose: () => void;
  busy: boolean;
}) {
  return (
    // Container-Query statt Media-Query: entscheidend ist die Breite DIESES
    // Slots, nicht die des Fensters. Derselbe Slot ist im Vierergrid rund
    // 470px breit und in der Viererreihe rund 230px — bei gleichem Fenster.
    <div className="@container flex min-h-0 min-w-0">
      <button
        type="button"
        onClick={onChoose}
        disabled={busy}
        aria-busy={busy}
        // Der zugängliche Name ist der Knopftext; das aria-label hält ihn
        // stabil, wenn die Erklärzeile darunter mitrendert (die sonst in den
        // Namen einginge und ihn bei jeder Slot-Breite anders lauten ließe).
        aria-label="Projekt wählen"
        className={`flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-(--pc-pane-border) px-4 py-3 text-center text-(--pc-descriptionForeground) transition-colors hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-foreground) disabled:pointer-events-none disabled:opacity-50 ${CHROME_FOCUS_RING}`}
      >
        <FolderPlusIcon />
        <span className="text-(length:--pc-chrome-fontSize) font-medium">
          Projekt wählen
        </span>
        {/* Erst ab 18rem Slot-Breite: in einer Viererreihen-Spalte bliebe von
            dem Satz ein vierzeiliger Block, der den Knopf darüber erschlägt.
            Ein leerer Slot braucht dort ein Ziel und eine Beschriftung, keine
            Prosa. */}
        <span className="hidden max-w-64 text-(length:--pc-chrome-fontSizeSmall) @2xs:block">
          PaneCrew startet darin eine echte Shell.
        </span>
      </button>
    </div>
  );
}

function FolderPlusIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.26"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      // Keine eigene Farbe mehr: das Icon erbt den Ton des Knopfes und hellt
      // beim Überfahren mit ihm zusammen auf, statt als einziges Element im
      // gedimmten Zustand zurückzubleiben.
      className="shrink-0"
    >
      <path d="M1.75 12.75v-9a.5.5 0 0 1 .5-.5h3.4l1.4 1.5h6.2a.5.5 0 0 1 .5.5v7.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5Z" />
      <path d="M8 6.75v4M6 8.75h4" />
    </svg>
  );
}
