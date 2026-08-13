import { useCallback, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { PaneDropRegistration } from "./useWebviewFileDrop";

/**
 * Ziehen einer Datei oder eines Ordners aus dem Explorer in eine Pane
 * (Ticket 25) — die zweite Drop-Quelle neben dem Drop aus dem Finder
 * (`useWebviewFileDrop.ts`). Beide enden im selben Einfüge-Weg: der Pfad
 * landet quotiert in der Eingabezeile des aktiven Terminals, ohne
 * werkzeugspezifisches Präfix.
 *
 * ZEIGER-EREIGNISSE, NICHT HTML5-DRAG-AND-DROP. Das ist keine Stilfrage:
 * Tauris `dragDropEnabled` ist per Default an (und muss anbleiben, sonst
 * stirbt der Finder-Drop, Begründung in `useWebviewFileDrop.ts`) — und
 * solange sie an ist, ist DOM-Drag-and-Drop im Webview abgeschaltet. Ein
 * `draggable`-Attribut auf der Baumzeile bliebe wirkungslos.
 *
 * KEINE ZOOM-UMRECHNUNG. Anders als beim Finder-Drop, der physische
 * Gerätepixel liefert und deshalb durch `zoom` teilt, sprechen `clientX`/
 * `clientY` und `getBoundingClientRect()` bereits denselben, mitskalierten
 * CSS-Rahmen. Eine Division hier wäre ein zweiter Zoom auf einen schon
 * gezoomten Wert und träfe bei jeder Stufe ≠ 100 % die falsche Pane.
 */

/** Wie weit sich der Zeiger bewegt haben muss, bevor aus dem Drücken ein
 * Ziehen wird. Ohne diese Schwelle wäre jeder Klick auf eine Baumzeile ein
 * Null-Pixel-Drag: das Öffnen der Datei — der mit Abstand häufigere Weg —
 * verlöre gegen den selteneren. 4px sind die übliche Untergrenze, unter der
 * das Zittern beim Klicken liegt. */
const DRAG_THRESHOLD_PX = 4;

export interface ExplorerPathDrag {
  /** An `onPointerDown` der Baumzeile. `absolutePath` geht ins Terminal (ein
   * Pfad, den eine Shell auflösen kann), `rowPath` ist der projekt-relative
   * Baumpfad und dient nur dazu, GENAU die gezogene Zeile zu markieren. */
  startDrag: (
    event: ReactPointerEvent<HTMLElement>,
    absolutePath: string,
    rowPath: string,
  ) => void;
  /** Der Baumpfad der gerade gezogenen Zeile (projekt-relativ), sonst `null`
   * — die Quellzeile zeigt daran ihren abgesenkten Zustand. */
  draggingPath: string | null;
  /** Wo der Zeiger beim Scharfwerden stand. Nur die Startposition der
   * Zeigerplakette: alles danach schreibt der Bewegungs-Handler direkt ins
   * DOM (siehe `ghostRef`), nicht in den State. */
  ghostOrigin: { x: number; y: number } | null;
  /** Die Zeigerplakette selbst. Bewusst ein Ref und kein State-Wertepaar:
   * `pointermove` feuert bei jeder Mausbewegung, und ein `setState` daraus
   * würde die gesamte App — inklusive der virtualisierten Baumliste — pro
   * Bewegung neu rendern. Genau diese Last hat die Virtualisierung entfernt,
   * sie über den Zieh-Vorgang zurückzuholen wäre ein schlechter Tausch. */
  ghostRef: React.RefObject<HTMLDivElement | null>;
  /** Die Pane, in der ein Loslassen JETZT landen würde — sonst `null`. */
  targetPaneId: string | null;
  /** Ob der unmittelbar folgende Klick noch zum eben beendeten Ziehen gehört
   * und deshalb verworfen werden muss. Verbraucht die Markierung. */
  consumeDragClick: () => boolean;
}

export function useExplorerPathDrag(
  dropTargets: PaneDropRegistration,
): ExplorerPathDrag {
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [ghostOrigin, setGhostOrigin] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [targetPaneId, setTargetPaneId] = useState<string | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const suppressClickRef = useRef(false);

  const consumeDragClick = useCallback(() => {
    const suppress = suppressClickRef.current;
    suppressClickRef.current = false;
    return suppress;
  }, []);

  const startDrag = useCallback(
    (
      event: ReactPointerEvent<HTMLElement>,
      absolutePath: string,
      rowPath: string,
    ) => {
      // Nur die primäre Taste zieht. Die sekundäre gehört dem Kontextmenü,
      // und ein Zieh-Vorgang, den man mit der rechten Taste startet, könnte
      // nur noch mit der linken enden.
      if (event.button !== 0) return;

      // Defensiv zurückgesetzt, nicht nur beim Beenden gesetzt: endete ein
      // vorheriges Ziehen ohne den erwarteten Klick (Zeiger außerhalb des
      // Fensters losgelassen, `pointercancel`), läge die Markierung sonst
      // noch da und verschluckte den nächsten ECHTEN Klick des Nutzers.
      suppressClickRef.current = false;

      const row = event.currentTarget;
      const startX = event.clientX;
      const startY = event.clientY;
      let armed = false;
      let lastX = startX;
      let lastY = startY;

      // Sofort beim Drücken, nicht erst beim Scharfwerden: ohne Capture
      // gingen `pointermove`/`pointerup` an das Element unter dem Zeiger,
      // sobald er die Explorer-Zeile verlässt — und das ist bei diesem
      // Vorgang der Normalfall, das Ziel liegt ja immer außerhalb. Das
      // Terminal darunter bekäme die Ereignisse und dieser Vorgang endete nie.
      // Mit Capture zielen sie auf die Zeile, weshalb die Listener unten
      // (wie beim Explorer-Resize in App.tsx) an ihr hängen und nicht am
      // Fenster. Der Klick bleibt davon unberührt: er entsteht weiterhin an
      // der Zeile.
      row.setPointerCapture(event.pointerId);

      const finish = (dropped: boolean) => {
        row.removeEventListener("pointermove", onMove);
        row.removeEventListener("pointerup", onUp);
        row.removeEventListener("pointercancel", onCancel);
        if (row.hasPointerCapture(event.pointerId)) {
          row.releasePointerCapture(event.pointerId);
        }
        if (armed) {
          // Auf JEDEN scharfen Vorgang, nicht nur auf kurze: durch das
          // Pointer-Capture landet der `pointerup` — und damit der Klick —
          // wieder an der Zeile, auch wenn losgelassen wurde. Ohne diese
          // Markierung öffnete jeder erfolgreiche Drop nebenbei die gezogene
          // Datei im Editor.
          suppressClickRef.current = true;
          if (dropped) {
            const hit = dropTargets.paneAtPoint({ x: lastX, y: lastY });
            // Außerhalb jeder Pane losgelassen heißt: nichts tun. Ein Drag
            // ins Leere ist ein Abbruch, keine halbe Handlung.
            if (hit !== null) dropTargets.insertInto(hit, [absolutePath]);
          }
        }
        setDraggingPath(null);
        setGhostOrigin(null);
        setTargetPaneId(null);
      };

      const onMove = (moveEvent: PointerEvent) => {
        lastX = moveEvent.clientX;
        lastY = moveEvent.clientY;
        if (!armed) {
          if (
            Math.abs(lastX - startX) < DRAG_THRESHOLD_PX &&
            Math.abs(lastY - startY) < DRAG_THRESHOLD_PX
          ) {
            return;
          }
          armed = true;
          setDraggingPath(rowPath);
          setGhostOrigin({ x: lastX, y: lastY });
        }
        // Direkt ans DOM statt in den State — Begründung an `ghostRef`. Die
        // Plakette ist im ersten Bild nach dem Scharfwerden noch nicht
        // gemountet; sie startet deshalb an `ghostOrigin` und wird ab hier
        // weitergeschoben.
        const ghost = ghostRef.current;
        if (ghost) {
          ghost.style.transform = `translate3d(${String(lastX)}px, ${String(lastY)}px, 0)`;
        }
        // Dieselbe Treffermathe wie der Finder-Drop. React lässt identische
        // set-Werte folgenlos verpuffen — gerendert wird nur beim
        // tatsächlichen Pane-Wechsel, nicht pro Mausbewegung.
        setTargetPaneId(dropTargets.paneAtPoint({ x: lastX, y: lastY }));
      };
      const onUp = () => {
        finish(true);
      };
      const onCancel = () => {
        finish(false);
      };

      row.addEventListener("pointermove", onMove);
      row.addEventListener("pointerup", onUp);
      row.addEventListener("pointercancel", onCancel);
    },
    [dropTargets],
  );

  return {
    startDrag,
    draggingPath,
    ghostOrigin,
    ghostRef,
    targetPaneId,
    consumeDragClick,
  };
}
