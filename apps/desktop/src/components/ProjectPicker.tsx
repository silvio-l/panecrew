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
// hier ist Amber Einladung, nicht Zustand.
//
// Das ASCII-Mini-Terminal trägt auf jedem leeren Slot für sich eine ambiente
// 3,5s-Choreografie (Nutzer-Korrektur 2026-08-13: "auf jeden einzelnen Slot",
// nicht nur beim leeren Gesamtgrid; danach ausgebaut vom simplen Blink zur
// Sequenz — Lichtlauf um den Rahmen, Chevron-Quittung, Cursor-Puls, s.
// AsciiEmblem-Kommentar unten und den Choreografie-Block in App.css; dort
// auch, warum diese eine Animation auf expliziten Nutzer-Wunsch WEICH
// ease-in-out läuft statt im harten steps-Takt der übrigen HUD-Events).
// Kein Glow, keine kinetische Typografie: das Emblem tippt nicht, kein
// Zeichen ändert sich — es wechseln ausschließlich Farbe/Deckkraft
// stehender Glyphen.
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { CHROME_FOCUS_RING } from "./ChromeTooltip";

export function ProjectPicker({
  onChoose,
  busy,
  restoring,
  slotNumber,
  focusModeActive,
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
  /** Ob IRGENDEINE Pane gerade maximiert ist (Ticket 19) — ein leerer Slot
   * kann selbst nie maximiert sein, muss dann aber genauso wie jede andere
   * unbeteiligte Zelle unsichtbar werden, sonst schiene sein Rahmen hinter
   * der maximierten Pane durch (PaneGrid.tsx behandelt PaneCell und
   * ProjectPicker sonst als zwei unabhängige Zweige). `visibility: hidden`
   * statt `display: none` — dieselbe Begründung wie bei `PaneCell`: der
   * Slot bleibt Teil der Grid-Spurberechnung, kollabiert also nicht. */
  focusModeActive: boolean;
}) {
  const { t } = useTranslation();
  const cellStyle: CSSProperties | undefined = focusModeActive
    ? { visibility: "hidden" }
    : undefined;
  if (restoring) {
    return (
      <div className="@container flex min-h-0 min-w-0" style={cellStyle}>
        <div className="pc-slotframe relative flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 rounded-lg px-4 py-3 text-center text-(--pc-descriptionForeground)">
          <HudCorners />
          <SlotReadout number={slotNumber} />
          {/* Dasselbe Emblem wie im leeren Slot: der Restore-Zustand ist
              derselbe Ort eine Sekunde früher — ohne das Emblem blitzte beim
              Befüllen erst ein karger, dann der gebaute Slot auf. Kein
              Blink hier: der Slot ist bereits auf ein Projekt festgelegt,
              kein offenes Angebot mehr. */}
          <AsciiEmblem blinking={false} />
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
    <div className="@container flex min-h-0 min-w-0" style={cellStyle}>
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
        <AsciiEmblem blinking />
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
// Farbe/Hover-Anzug in App.css (.pc-hud-readout): gedimmt im Ruhezustand,
// voller Beschreibungston beim Überfahren — derselbe Takt wie Ecken und
// Emblem, ein Slot wacht als Ganzes auf.
function SlotReadout({ number }: { number: number }) {
  return (
    <span
      aria-hidden="true"
      className="pc-hud-readout pointer-events-none absolute left-3 top-2 font-(family-name:--pc-terminal-fontFamily) text-[10px] tracking-[0.25em]"
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
//
// Das Emblem ist in EIGENE Spans zerlegt, weil die 3,5s-Choreografie in
// App.css (Kommentarblock dort: Lichtlauf → Chevron-Quittung → Cursor-Puls)
// jede Stimme einzeln adressieren muss — CSS darf nur Farbe/Deckkraft
// stehender Glyphen wechseln, also braucht jedes unabhängig animierte
// Stück Rahmen sein eigenes Element:
//   - `__prompt-glyph` (Chevron) und `__cursor` (Block) wie gehabt,
//   - der Box-Drawing-Rahmen als zehn `__seg`-Spans, deren Position im
//     Uhrzeigersinn (0 = obere linke Ecke) als `--pc-hud-seg` inline
//     mitgeht — App.css macht daraus den 150ms-Versatz des Lichtlaufs.
// Ohne die `--blinking`-Klasse (restoring-Zweig) sind die Segmente inerte
// Spans und erben schlicht die Rahmenfarbe. `blinking` ist auf jedem echten
// leeren Slot für sich wahr (Nutzer-Korrektur 2026-08-13: "auf jeden
// einzelnen Slot", nicht nur beim Kaltstart mit leerem Gesamtgrid).
function AsciiEmblem({ blinking }: { blinking: boolean }) {
  return (
    <pre
      aria-hidden="true"
      className={`pc-hud-emblem font-(family-name:--pc-terminal-fontFamily) text-[11px] leading-[1.15]${blinking ? " pc-hud-emblem--blinking" : ""}`}
    >
      <Seg index={0}>{"╭───"}</Seg>
      <Seg index={1}>{"───"}</Seg>
      <Seg index={2}>{"───╮"}</Seg>
      {"\n"}
      <Seg index={9}>{"│"}</Seg>
      {" "}
      <span className="pc-hud-emblem__prompt">
        <span className="pc-hud-emblem__prompt-glyph">{"❯"}</span>{" "}
        <span className="pc-hud-emblem__cursor">{"█"}</span>
      </span>
      {"     "}
      <Seg index={3}>{"│"}</Seg>
      {"\n"}
      <Seg index={8}>{"│"}</Seg>
      {"         "}
      <Seg index={4}>{"│"}</Seg>
      {"\n"}
      <Seg index={7}>{"╰───"}</Seg>
      <Seg index={6}>{"───"}</Seg>
      <Seg index={5}>{"───╯"}</Seg>
    </pre>
  );
}

// Ein Rahmensegment des Rundlauf-Scans. Nur ein Span mit Positionsnummer —
// Takt, Fenster und Farben stehen komplett in App.css (@keyframes
// pc-hud-scan), hier steht ausschließlich, WO im Uhrzeigersinn das Segment
// sitzt.
function Seg({ index, children }: { index: number; children: string }) {
  return (
    <span
      className="pc-hud-emblem__seg"
      style={{ "--pc-hud-seg": index } as CSSProperties}
    >
      {children}
    </span>
  );
}
