import type { RefObject } from "react";

// Die Plakette am Zeiger, solange ein Terminal-Tab in eine andere Pane
// gezogen wird (Ticket 32, nachgerüstet mit dem Nutzer-Befund "Ich muss
// erkennen können, dass ich diesen Tab jetzt in der Hand habe") — das
// Schwester-Instrument zum PathDragGhost des Explorer-Ziehens, mit exakt
// dessen Mechanik: `fixed` am Nullpunkt, der Zieh-Hook (`usePaneDrag.ts`)
// schiebt sie per `element.style.transform` direkt übers Ref statt über
// State, denn `pointermove` feuert bei jeder Mausbewegung und ein Render pro
// Bewegung ginge durch die gesamte App.
//
// Sie beantwortet dieselben zwei Fragen wie dort: WAS hängt am Zeiger (die
// Tab-Nummer bzw. der eigene Name, im Chip-Duktus der Tab-Leiste) — und
// WÜRDE ein Loslassen jetzt etwas tun (über der eigenen Farbe: Akzent über
// einer gültigen Ziel-Pane, sonst neutral). Dieselbe ⇥-Glyphe wie das
// Drop-Ziel-HUD der Pane (`PaneDropInvite`, PaneGrid.tsx) — ein Signal an
// beiden Enden desselben Vorgangs, nicht zwei Vokabeln.
//
// `aria-hidden` und ohne eigenen i18n-Import (der fertige Text kommt vom
// Aufrufer, der `t()` ohnehin hat — dieselbe Linie wie PaneDropInvite): ein
// Zeiger-Zug ist für Screenreader-Nutzung kein Weg, der Chip behält daneben
// seinen vollen Tastatur-/Kontextmenü-Pfad.
export function TabDragGhost({
  ghostRef,
  text,
  origin,
  overTarget,
}: {
  /** Schreibziel für die Zeigerposition (s. Kopfkommentar) — der Hook setzt
   * ausschließlich `style.transform`. */
  ghostRef: RefObject<HTMLDivElement | null>;
  /** Fertig übersetzt: der Anzeigename des gezogenen Tabs (eigener Name oder
   * "Terminal N"). */
  text: string;
  /** Zeigerposition beim Scharfwerden — das erste Bild, danach übernimmt der
   * Hook. Ohne diesen Startwert erschiene die Plakette einen Frame lang in
   * der linken oberen Ecke. */
  origin: { x: number; y: number };
  /** Ob der Zeiger gerade über einer Pane steht, in der ein Loslassen den
   * Tab tatsächlich einhängen würde. */
  overTarget: boolean;
}) {
  return (
    <div
      ref={ghostRef}
      aria-hidden="true"
      // Test-Haken (App.test.tsx) — ein aria-verstecktes Deko-Element hat
      // keine Rolle, über die es sich sonst greifen ließe (dasselbe Idiom wie
      // `data-trace-stub` in PaneTabs.tsx).
      data-tab-drag-ghost=""
      // `pointer-events-none` ist wesentlich, nicht kosmetisch: läge die
      // Plakette unter dem Zeiger im Weg, träfe die Trefferprüfung des Zugs
      // sie selbst statt der Pane darunter.
      className="pointer-events-none fixed left-0 top-0 z-50"
      style={{ transform: `translate3d(${String(origin.x)}px, ${String(origin.y)}px, 0)` }}
    >
      {/* Versetzt statt zentriert unter dem Zeiger: die Spitze soll die Pane
          darunter zeigen, nicht die Plakette verdecken. */}
      <span
        className={`ml-3.5 mt-2.5 flex max-w-40 items-center gap-1.5 rounded-(--pc-paneControl-radius) border py-0.5 pl-1.5 pr-2 font-(family-name:--pc-terminal-fontFamily) text-(length:--pc-chrome-fontSizeSmall) ${
          overTarget
            ? "border-(--pc-pane-activeBorder)/45 bg-(--pc-pane-background)/95"
            : "border-(--pc-pane-border) bg-(--pc-pane-background)/95"
        }`}
      >
        <span
          className={
            overTarget
              ? "text-(--pc-pane-activeBorder)"
              : "text-(--pc-descriptionForeground)"
          }
        >
          ⇥
        </span>
        <span className="min-w-0 truncate tabular-nums text-(--pc-foreground)">
          {text}
        </span>
      </span>
    </div>
  );
}
