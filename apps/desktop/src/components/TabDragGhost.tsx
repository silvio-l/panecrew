import type { RefObject } from "react";

// Das Chip-Abbild am Zeiger, solange ein Terminal-Tab gezogen wird (Ticket
// 32; Präzisions-Runde nach dem Nutzer-Befund "ich möchte auch den Tab
// sehen, wenn ich im Drag-Vorgang bin und ihn ziehe soll ich ihn quasi in
// der Hand halten") — das Schwester-Instrument zum PathDragGhost des
// Explorer-Ziehens, mit exakt dessen Mechanik: `fixed` am Nullpunkt, der
// Zieh-Hook (`usePaneDrag.ts`) schiebt es per `element.style.transform`
// direkt übers Ref statt über State, denn `pointermove` feuert bei jeder
// Mausbewegung und ein Render pro Bewegung ginge durch die gesamte App.
// Bewusst OHNE Easing auf der Position (Bewegung aus Interaktion, nie aus
// Easing — Direction-Contract): das Abbild klebt 1:1 am Zeiger.
//
// Seit der Präzisions-Runde ist es kein Text-Schild mit ⇥-Glyphe mehr,
// sondern ein Abbild des Chips selbst — dieselben Maße und Töne wie
// `TerminalTabChip` (PaneTabs.tsx: h-6, oben gerundet, Akzent-Box mit
// /14-Lasur, Nummer in Terminalschrift), damit "das habe ich in der Hand"
// wörtlich stimmt: man sieht den Tab, nicht eine Beschreibung von ihm. Der
// eigene Name steht, falls vergeben, daneben (im Chip wohnt er nur im
// Tooltip — hier gibt es keinen Hover, also zeigt das Abbild ihn direkt).
// Es beantwortet weiter die zweite Frage des Vorgängers: WÜRDE ein Loslassen
// jetzt etwas tun — über einer gültigen Ziel-Pane spricht die Box in voller
// Akzent-Sättigung, sonst in derselben 45%-Dämpfung, mit der auch die
// Kandidaten-Ecken des Drop-HUDs warten (`pc-hud-corner--invite-dim`).
//
// `aria-hidden` und ohne eigenen i18n-Import (Nummer/Name kommen nackt vom
// Aufrufer): ein Zeiger-Zug ist für Screenreader-Nutzung kein Weg, der Chip
// behält daneben seinen vollen Tastatur-/Kontextmenü-Pfad.
export function TabDragGhost({
  ghostRef,
  number,
  label,
  origin,
  overTarget,
}: {
  /** Schreibziel für die Zeigerposition (s. Kopfkommentar) — der Hook setzt
   * ausschließlich `style.transform`. */
  ghostRef: RefObject<HTMLDivElement | null>;
  /** Die Nummer des gezogenen Tabs (Position in seiner Quell-Leiste). */
  number: number;
  /** Sein eigener Name (`renameTerminalTab`) — `null` heißt "kein eigener
   * Name", das Abbild zeigt dann nur die Nummer, wie der Chip selbst. */
  label: string | null;
  /** Zeigerposition beim Scharfwerden — das erste Bild, danach übernimmt der
   * Hook. Ohne diesen Startwert erschiene das Abbild einen Frame lang in
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
      // `pointer-events-none` ist wesentlich, nicht kosmetisch: läge das
      // Abbild unter dem Zeiger im Weg, träfe die Trefferprüfung des Zugs
      // es selbst statt der Pane darunter.
      className="pointer-events-none fixed left-0 top-0 z-50"
      style={{ transform: `translate3d(${String(origin.x)}px, ${String(origin.y)}px, 0)` }}
    >
      {/* Versetzt statt zentriert unter dem Zeiger: die Spitze soll die Pane
          darunter zeigen, nicht das Abbild verdecken. Die eigene, satte
          Grundfläche unter der Lasur ist nötig, weil das Abbild — anders als
          der Chip — über beliebigem Inhalt schwebt statt auf Header-Grund. */}
      <span
        className={`relative ml-3.5 mt-2.5 flex h-6 min-w-6 max-w-48 items-center justify-center gap-1.5 rounded-t-(--pc-paneControl-radius) border border-b-2 bg-(--pc-pane-background) px-3 text-(length:--pc-chrome-fontSizeSmall) font-semibold ${
          overTarget
            ? "border-(--pc-pane-activeBorder) text-(--pc-paneHeader-activeForeground)"
            : "border-(--pc-pane-activeBorder)/45 text-(--pc-paneHeader-foreground)"
        }`}
      >
        <span
          className={`pointer-events-none absolute inset-0 rounded-t-(--pc-paneControl-radius) ${
            overTarget
              ? "bg-(--pc-pane-activeBorder)/14"
              : "bg-(--pc-pane-activeBorder)/8"
          }`}
        />
        <span className="font-(family-name:--pc-terminal-fontFamily) tabular-nums">
          {number}
        </span>
        {label !== null && (
          <span className="min-w-0 truncate font-medium">{label}</span>
        )}
      </span>
    </div>
  );
}
