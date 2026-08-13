// Der Boolean-Schalter des Chrome — aktuell nur im Settings-Fenster benutzt,
// aber bewusst hier statt inline in SettingsWindow.tsx, damit der nächste
// Boolean-Bedarf (Extension-Settings bringen eigene mit) nicht wieder eine
// zweite Fassung erfindet.
//
// Formsprache: KEINE generische iOS-Pille. Das Feld ist ein eckiges
// TUI-Register (1px-Hairline, 3px-Radius) mit einem massiven Blockcursor
// darin — dieselbe Grundform wie das `_` der Wortmarke, und damit die
// terminaleigene Art, "hier steht der Zustand" zu zeigen. Links davon ein
// Monospace-Readout (AN/AUS), fest positioniert: der Zustand ist damit
// dreifach codiert (Position des Blocks, Farbe des Blocks, Klartext), nicht
// nur über 2px Knopfversatz wie in der Pillen-Fassung davor.
//
// Farbverhältnis — der eigentliche Fix (2026-08-13, dritter Anlauf):
// Vorher war die Füllung Amber und der Knopf --pc-foreground. Gemessen sind
// das 1,29:1 (Dark) und 2,97:1 (Light) — der Knopf verschwand praktisch in
// seiner eigenen Füllung, im Dark-Theme vollständig. Die Ursache ist
// strukturell, nicht Tokenwahl: --pc-pane-activeBorder liegt Dark (#e59656)
// ÜBER und Light (#a05605) UNTER der mittleren Helligkeit, ein einzelnes
// Knopf-Token kann also gar nicht in beiden Themes gegen die Füllung
// bestehen. Deshalb ist das Verhältnis hier umgedreht: die Fläche bleibt in
// beiden Zuständen neutral (--pc-widget-background), Amber trägt nur der
// Block — und der misst 7,33:1 (Dark) bzw. 5,27:1 (Light) gegen den Grund.
// Ein Wash/Rahmen in Amber auf der Fläche wäre zudem wörtlich das Rezept des
// aktiven Tabs (PaneTabs.tsx, `border-accent + bg-accent/14`) und würde die
// vom Direction Contract geforderte Formunterscheidung wieder einziehen.
//
// Der Akzent an dieser Stelle ist die vom Nutzer am 2026-08-13 erteilte
// Erweiterung der Tab-Ausnahme; verwechselbar mit Pane-Fokus (umlaufende
// Hairline bei 45%) oder aktivem Tab (Kasten + doppelte Unterkante) ist ein
// massiver Block in einem Feld nicht.
import type { ReactNode } from "react";
import { CHROME_FOCUS_RING } from "./ChromeTooltip";

// Geometrie in ganzen Pixeln statt Tailwind-Stufen: das Feld ist 34x18 inkl.
// 1px Rahmen, der Innenraum also 32x16, der Block sitzt mit 2px Luft rundum
// und ist 10x12 groß. Daraus folgt der Weg exakt: 32 - 2 - 2 - 10 = 18px
// (translate-x-[18px] unten) — auf 0,5er-Stufen gerundete Werte würden auf
// nicht-ganzzahligen DPR-Skalierungen als unscharfe Blockkante sichtbar.

export function ToggleSwitch({
  checked,
  disabled = false,
  onChange,
  label,
  onText,
  offText,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  /** Zugänglicher Name — das Readout daneben ist der Zustand, nicht der Name. */
  label: string;
  onText: ReactNode;
  offText: ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`group flex shrink-0 items-center gap-2 rounded-sm disabled:pointer-events-none disabled:opacity-50 ${CHROME_FOCUS_RING}`}
    >
      <span
        aria-hidden="true"
        className={`w-8 shrink-0 text-right font-(family-name:--pc-terminal-fontFamily) text-[10px] leading-none tracking-[0.14em] uppercase transition-colors ${
          checked ? "text-(--pc-pane-activeBorder)" : "text-(--pc-descriptionForeground)"
        }`}
      >
        {checked ? onText : offText}
      </span>
      <span
        aria-hidden="true"
        className="relative block h-[18px] w-[34px] shrink-0 overflow-hidden rounded-[3px] border border-(--pc-widget-border) bg-(--pc-widget-background) transition-colors group-hover:border-(--pc-descriptionForeground)"
      >
        <span
          // Die Mikroanimation: der Block fährt in 200ms mit stark
          // auslaufender Kurve in seine Rasterposition — deutlich länger als
          // die 150ms-Hover-Zeit des Chrome, weil hier eine Strecke
          // zurückgelegt wird und nicht nur eine Farbe kippt (Nutzerfreigabe
          // 2026-08-13 für längere Mikroanimationen). Reines Farbkippen
          // (Label-Text, Feldrahmen beim Hover) bleibt dagegen beim
          // Standard-150ms-Übergang des restlichen Chrome — nur diese eine
          // Strecke rechtfertigt die längere Dauer. Zusätzlich lehnt sich
          // der Block beim Hover 1px in seine künftige Richtung: das
          // Bedienziel kündigt an, wohin es schaltet, bevor geklickt wird.
          // Kein Glow, keine kinetische Typografie — der Klartext daneben
          // wechselt hart.
          className={`absolute top-[2px] left-[2px] h-[12px] w-[10px] rounded-[1px] transition-[transform,background-color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            checked
              ? "translate-x-[18px] bg-(--pc-pane-activeBorder) group-hover:translate-x-[17px]"
              : "translate-x-0 bg-(--pc-descriptionForeground) group-hover:translate-x-[1px]"
          }`}
        />
      </span>
    </button>
  );
}
