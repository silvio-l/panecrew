import type { RefObject } from "react";
import { fileNameFromPath } from "../explorer/filePath";

// Die Plakette am Zeiger, solange eine Baumzeile in eine Pane gezogen wird
// (Ticket 25). Sie beantwortet die zwei Fragen, die während des Ziehens offen
// sind: WAS hängt am Zeiger — und WÜRDE ein Loslassen jetzt überhaupt etwas
// tun.
//
// Die zweite Frage beantwortet sie über ihre eigene Farbe: über einer Pane
// nimmt sie den Akzent an, sonst bleibt sie neutral. Das ist die
// funktionale Mikroanimation dieses Vorgangs — Bewegung entsteht aus dem
// Zeiger, die Zustandsänderung schaltet hart (kein `transition-*`, Direction
// Contract). Der Akzent ist derselbe, den die Zielpane in ihren
// Einladungs-Ecken zeigt (`TerminalPane.tsx`): dasselbe Signal an beiden
// Enden desselben Vorgangs, nicht zwei Vokabeln.
//
// `aria-hidden` und ohne Übersetzung, absichtlich: ein Zieh-Vorgang mit dem
// Zeiger ist für Screenreader-Nutzung ohnehin kein Weg, und die Baumzeile
// behält daneben ihren vollständigen Tastaturpfad (Auswählen, Öffnen). Eine
// vorgelesene Plakette, die nur während einer Mausbewegung existiert, wäre
// Lärm ohne erreichbare Handlung.
export function PathDragGhost({
  ghostRef,
  path,
  origin,
  overPane,
}: {
  /** Schreibziel für die Zeigerposition. Der Zieh-Hook schiebt die Plakette
   * direkt über diesen Ref (`element.style.transform`) statt über State —
   * `pointermove` feuert bei jeder Mausbewegung, und ein Render pro Bewegung
   * ginge durch die gesamte App inklusive der virtualisierten Baumliste. */
  ghostRef: RefObject<HTMLDivElement | null>;
  /** Der gezogene Baumpfad; angezeigt wird nur sein letzter Bestandteil. */
  path: string;
  /** Zeigerposition beim Scharfwerden — das erste Bild, danach übernimmt der
   * Hook. Ohne diesen Startwert erschiene die Plakette einen Frame lang in
   * der linken oberen Ecke. */
  origin: { x: number; y: number };
  /** Ob der Zeiger gerade über einer Pane steht, in der ein Loslassen den
   * Pfad tatsächlich einfügen würde. */
  overPane: boolean;
}) {
  return (
    <div
      ref={ghostRef}
      aria-hidden="true"
      // `fixed` am Nullpunkt plus `translate3d`: der Hook setzt danach nur
      // noch genau diese eine Eigenschaft, ohne Layout-Durchgang.
      // `pointer-events-none` ist wesentlich und nicht kosmetisch — läge die
      // Plakette unter dem Zeiger im Weg, träfe die Trefferprüfung sie selbst
      // statt der Pane darunter.
      className="pointer-events-none fixed left-0 top-0 z-50"
      style={{ transform: `translate3d(${String(origin.x)}px, ${String(origin.y)}px, 0)` }}
    >
      {/* Versetzt statt zentriert unter dem Zeiger: die Spitze soll die Pane
          darunter zeigen, nicht die Plakette verdecken. */}
      <span
        className={`ml-3.5 mt-2.5 flex max-w-56 items-center gap-1.5 rounded-(--pc-paneControl-radius) border py-0.5 pl-1.5 pr-2 font-(family-name:--pc-terminal-fontFamily) text-(length:--pc-chrome-fontSize) ${
          overPane
            ? "border-(--pc-pane-activeBorder)/45 bg-(--pc-pane-background)/95"
            : "border-(--pc-pane-border) bg-(--pc-pane-background)/95"
        }`}
      >
        {/* Dieselbe Glyphe wie das Drop-Ziel-HUD der Pane — sie bezeichnet
            dort wie hier „hier hinein". */}
        <span
          className={
            overPane
              ? "text-(--pc-pane-activeBorder)"
              : "text-(--pc-descriptionForeground)"
          }
        >
          ⇣
        </span>
        {/* Nur der Name, nicht der Pfad: die Plakette klebt am Zeiger und
            steht damit mitten im Blickfeld — ein voller Pfad machte sie zum
            Balken quer über die Panes. Was gezogen wird, ist an der
            abgesenkten Zeile im Baum ohnehin weiter ablesbar. `truncate`
            fängt die wenigen sehr langen Namen — zusammen mit `min-w-0`, ohne
            das ein Flex-Kind nicht unter seine Inhaltsbreite schrumpft und
            `max-w-56` an der Plakette wirkungslos bliebe. */}
        <span className="min-w-0 truncate text-(--pc-foreground)">
          {fileNameFromPath(path)}
        </span>
      </span>
    </div>
  );
}
