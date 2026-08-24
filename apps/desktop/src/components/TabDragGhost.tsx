import type { RefObject } from "react";

// Pointer-following preview for any dragged tab. The drag hook writes position
// directly through the ref to avoid a React render per pointermove. Stable
// content identity is shown instead of source/target position, and saturation
// communicates whether dropping at the current pointer would succeed.
export function TabDragGhost({
  ghostRef,
  label,
  origin,
  overTarget,
}: {
  /** Schreibziel für die Zeigerposition (s. Kopfkommentar) — der Hook setzt
   * ausschließlich `style.transform`. */
  ghostRef: RefObject<HTMLDivElement | null>;
  /** Stable content identity, never the source or target position. */
  label: string;
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
        <span className="min-w-0 truncate font-medium">{label}</span>
      </span>
    </div>
  );
}
