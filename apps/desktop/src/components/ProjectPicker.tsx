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
// HUD-Sprache statt gestrichelter Hairline (2026-08-13, Nutzer-Direktive
// „technoide HUD-Details + ASCII-Deko"): vier Eckwinkel rahmen den Slot wie
// einen Sucher — dieselbe 1px-Grammatik wie die Pane-Rahmen, aber auf einen
// Blick als "hier ist noch nichts, hier kann etwas hin" lesbar. Dazu ein
// Slot-Nummern-Readout in der Terminalschrift (oben links, rein numerisch,
// deshalb keine i18n-Frage) und das Marken-Emblem als ASCII-Zeichnung statt
// des früheren generischen Ordner-Icons. Beim Überfahren wechseln Winkel und
// Emblem in den Amber-Akzent: ein leerer Slot kann nie fokussiert sein, die
// Fokus-Exklusivität des Akzents (Direction Contract) bleibt also unberührt —
// hier ist Amber Einladung, nicht Zustand. Statisch, kein Glow, keine
// kinetische Typografie: das Emblem steht, es tippt nicht.
import { useTranslation } from "react-i18next";
import { CHROME_FOCUS_RING } from "./ChromeTooltip";

export function ProjectPicker({
  onChoose,
  busy,
  restoring,
  slotNumber,
}: {
  onChoose: () => void;
  busy: boolean;
  /** Dieser Slot ist Teil der gerade wiederhergestellten Sitzung und wartet
   * noch auf sein Projekt (Baum + Git-Deko werden gelesen) — kein leerer
   * Slot im eigentlichen Sinn, nur noch nicht fertig befüllt. Ohne dieses
   * Signal zeigte der Slot bis dahin einen ganz normalen, klickbaren
   * "Projekt wählen"-Knopf: ein Klick währenddessen würde mit der laufenden
   * Wiederherstellung um genau diesen Slot konkurrieren (2026-08-12). */
  restoring?: boolean;
  /** 1-basierte Slot-Position im aktiven Template (PaneGrid reicht den
   * Array-Index durch) — reine Anzeige im HUD-Readout. */
  slotNumber: number;
}) {
  const { t } = useTranslation();
  if (restoring) {
    return (
      <div className="@container flex min-h-0 min-w-0">
        <div className="pc-slotframe relative flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 rounded-lg px-4 py-3 text-center text-(--pc-descriptionForeground)">
          <HudCorners />
          <SlotReadout number={slotNumber} />
          <span className="text-(length:--pc-chrome-fontSize) font-medium">
            {t("common.loading")}
          </span>
        </div>
      </div>
    );
  }

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
        aria-label={t("projectPicker.choose")}
        className={`pc-slotframe relative flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 rounded-lg px-4 py-3 text-center text-(--pc-descriptionForeground) transition-colors hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-foreground) disabled:pointer-events-none disabled:opacity-50 ${CHROME_FOCUS_RING}`}
      >
        <HudCorners />
        <SlotReadout number={slotNumber} />
        <AsciiEmblem />
        <span className="text-(length:--pc-chrome-fontSize) font-medium">
          {t("projectPicker.choose")}
        </span>
        {/* Erst ab 18rem Slot-Breite: in einer Viererreihen-Spalte bliebe von
            dem Satz ein vierzeiliger Block, der den Knopf darüber erschlägt.
            Ein leerer Slot braucht dort ein Ziel und eine Beschriftung, keine
            Prosa. */}
        <span className="hidden max-w-64 text-(length:--pc-chrome-fontSizeSmall) @2xs:block">
          {t("projectPicker.hint")}
        </span>
      </button>
    </div>
  );
}

// Vier Sucher-Ecken, je ein L aus zwei 1px-Kanten. Farb- und Hover-Verhalten
// stehen in App.css (.pc-hud-corner, geschaltet über .pc-slotframe:hover) —
// vier Spans statt eines Verlaufs-Tricks, weil border-color sauber mit den
// 150ms-Hover-Transitions mitzieht, ein background-image nicht.
function HudCorners() {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0">
      <span className="pc-hud-corner pc-hud-corner--tl" />
      <span className="pc-hud-corner pc-hud-corner--tr" />
      <span className="pc-hud-corner pc-hud-corner--bl" />
      <span className="pc-hud-corner pc-hud-corner--br" />
    </span>
  );
}

// Slot-Position als HUD-Readout, Terminalschrift, gesperrt gesetzt. Rein
// numerisch und dekorativ (aria-hidden): der zugängliche Name des Knopfs
// bleibt "Projekt wählen", die Nummer ist Orientierung fürs Auge im Grid.
function SlotReadout({ number }: { number: number }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute left-3 top-2 font-(family-name:--pc-terminal-fontFamily) text-[10px] tracking-[0.25em] opacity-70"
    >
      {String(number).padStart(2, "0")}
    </span>
  );
}

// ASCII-Deko im Sinn der HUD-Direktive: ein Mini-Terminal-Fenster aus
// Box-Drawing-Zeichen, darin Prompt-Chevron und Cursor-Block — der leere
// Slot zeigt als Zeichnung genau das, was er nach dem Klick wird. Bewusst
// KEINE Pixel-Nachbildung der Marke: Blockzeichen-Treppen zerfallen bei
// 10px zu Klumpen (mehrere Anläufe, per Kandidaten-Vergleich verworfen),
// Box-Drawing rendert dagegen gestochen scharf, und die echte Marke bleibt
// ohnehin das SVG in TitleBar.tsx. Zweifarbig: der Rahmen bleibt leise im
// Beschreibungston, Prompt + Cursor tragen gedimmtes Amber; beim Überfahren
// zieht beides an (App.css, .pc-slotframe:hover). Keine Buchstaben, deshalb
// kein i18n-Fall; als reine Zeichnung für Screenreader unsichtbar.
function AsciiEmblem() {
  return (
    <pre
      aria-hidden="true"
      className="pc-hud-emblem font-(family-name:--pc-terminal-fontFamily) text-[11px] leading-[1.15]"
    >
      {"╭─────────╮\n│ "}
      <span className="pc-hud-emblem__prompt">{"❯ █"}</span>
      {"     │\n│         │\n╰─────────╯"}
    </pre>
  );
}
