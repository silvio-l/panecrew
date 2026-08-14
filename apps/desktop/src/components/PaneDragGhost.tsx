import type { RefObject } from "react";

// Das Kopfzeilen-Abbild am Zeiger, solange eine GANZE Pane am Header-Griff
// gezogen wird (Slot-Tausch, Ticket 20, und seit 4d92890 der Umzug auf einen
// leeren Slot) — das Schwester-Instrument zum TabDragGhost des Tab-Zugs, mit
// exakt dessen Mechanik: `fixed` am Nullpunkt, der Zieh-Hook
// (`usePaneDrag.ts`) schiebt es per `element.style.transform` direkt übers
// Ref statt über State (`pointermove` feuert pro Mausbewegung, ein Render pro
// Bewegung ginge durch die gesamte App), keine Easing auf der Position
// (Bewegung aus Interaktion, nie aus Easing — Direction-Contract).
//
// Ursprünglich gab es hier bewusst KEIN Abbild — die Begründung lautete, die
// opacity-50-Dämpfung der gezogenen Zelle selbst sei das "in der
// Hand"-Signal. Der Nutzer hat dem nach der Release-Abnahme explizit
// widersprochen ("der Pane-Ghost sollte sichtbar sein beim Drag analog wie
// auch beim tab-ghost") — beide Züge sprechen jetzt dieselbe Sprache: Quelle
// tritt zurück UND ein Abbild klebt am Zeiger. Die Dämpfung bleibt daneben
// bestehen, sie beantwortet eine andere Frage (WO komme ich her) als das
// Abbild (WAS halte ich).
//
// Inhalt ist die Kopfzeilen-Identität der Pane — Prompt-Chevron ❯ plus
// Projektname in der Terminalschrift, exakt die Zeile, an der man gerade
// zieht (`TerminalPane.tsx`/`FileEditor.tsx`-Header) — keine Tab-Nummer, die
// eine Pane nicht hat. Prinzip wie beim Tab-Abbild: man sieht das Gehaltene,
// nicht eine Beschreibung davon. `overTarget` beantwortet die zweite Frage
// (WÜRDE ein Loslassen jetzt etwas tun — Tausch auf belegter Pane oder Umzug
// auf leeren Slot) mit derselben Akzent-Schaltung wie dort: volle Sättigung
// überm gültigen Ziel, sonst die 45%-Wartedämpfung der Kandidaten-Ecken.
//
// `aria-hidden` und ohne i18n (der Name kommt nackt vom Aufrufer): ein
// Zeiger-Zug ist für Screenreader-Nutzung kein Weg.
export function PaneDragGhost({
  ghostRef,
  projectName,
  origin,
  overTarget,
}: {
  /** Schreibziel für die Zeigerposition — der Hook setzt ausschließlich
   * `style.transform`. */
  ghostRef: RefObject<HTMLDivElement | null>;
  /** Der Projektname der gezogenen Pane — ihre Kopfzeilen-Identität. */
  projectName: string;
  /** Zeigerposition beim Scharfwerden — das erste Bild, danach übernimmt der
   * Hook (ohne Startwert erschiene das Abbild einen Frame lang links oben). */
  origin: { x: number; y: number };
  /** Ob der Zeiger gerade über einem Ziel steht, auf dem ein Loslassen etwas
   * täte (belegte Pane: Tausch; leerer Slot: Umzug). */
  overTarget: boolean;
}) {
  return (
    <div
      ref={ghostRef}
      aria-hidden="true"
      // Test-Haken (App.test.tsx) — dasselbe Idiom wie `data-tab-drag-ghost`.
      data-pane-drag-ghost=""
      // `pointer-events-none` ist wesentlich, nicht kosmetisch: läge das
      // Abbild unter dem Zeiger im Weg, träfe die Trefferprüfung des Zugs es
      // selbst statt der Zelle darunter.
      className="pointer-events-none fixed left-0 top-0 z-50"
      style={{ transform: `translate3d(${String(origin.x)}px, ${String(origin.y)}px, 0)` }}
    >
      {/* Versetzt statt zentriert unter dem Zeiger (wie beim Tab-Abbild): die
          Spitze soll das Ziel darunter zeigen, nicht das Abbild verdecken.
          Volle Rundung statt der nur-oben-Rundung des Tab-Chips: dieses
          Abbild zitiert die Header-ZEILE, keinen Tab, der auf einer
          Unterkante aufsitzt. */}
      <span
        className={`relative ml-3.5 mt-2.5 flex h-6 max-w-56 items-center gap-1.5 rounded-(--pc-paneControl-radius) border bg-(--pc-pane-background) px-3 text-(length:--pc-chrome-fontSizeSmall) font-medium ${
          overTarget
            ? "border-(--pc-pane-activeBorder) text-(--pc-paneHeader-activeForeground)"
            : "border-(--pc-pane-activeBorder)/45 text-(--pc-paneHeader-foreground)"
        }`}
      >
        <span
          className={`pointer-events-none absolute inset-0 rounded-(--pc-paneControl-radius) ${
            overTarget
              ? "bg-(--pc-pane-activeBorder)/14"
              : "bg-(--pc-pane-activeBorder)/8"
          }`}
        />
        <span className="shrink-0 font-(family-name:--pc-terminal-fontFamily)">
          {"❯"}
        </span>
        <span className="min-w-0 truncate font-(family-name:--pc-terminal-fontFamily)">
          {projectName}
        </span>
      </span>
    </div>
  );
}
