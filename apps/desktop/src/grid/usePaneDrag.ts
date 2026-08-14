import { useCallback, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { paneIdAtPoint, type PaneRect } from "../terminal/dropRouting";

/**
 * Zieh-Vorgänge INNERHALB des Grids, deren Ziel eine andere Pane ist: der
 * Slot-Tausch zweier Panes (Ticket 20, Griff = Pane-Header) und das
 * Verschieben eines Terminal-Tabs in eine andere Pane desselben Projekts
 * (Ticket 32, Griff = Tab-Chip). Beide Gesten unterscheiden sich nur in
 * Quelle und Wirkung — Schwelle, Pointer-Capture, Trefferprüfung und das
 * Verschlucken des Abschlussklicks sind identisch, deshalb ein Hook mit
 * generischer Quelle statt zweier fast gleicher.
 *
 * ZEIGER-EREIGNISSE, NICHT HTML5-DRAG-AND-DROP — derselbe Zwang wie beim
 * Explorer-Ziehen (`terminal/useExplorerPathDrag.ts`, ausführliche
 * Begründung dort): Tauris `dragDropEnabled` ist an (und muss anbleiben,
 * sonst stirbt der Finder-Drop) und schaltet damit DOM-Drag-and-Drop im
 * Webview ab. Ein `draggable`-Attribut bliebe wirkungslos.
 *
 * KEINE ZOOM-UMRECHNUNG: `clientX`/`clientY` und `getBoundingClientRect()`
 * sprechen bereits denselben, mitskalierten CSS-Rahmen (auch dazu die
 * Begründung in `useExplorerPathDrag.ts`).
 */

/** Identisch zum Explorer-Ziehen: unterhalb dieser Strecke ist die Geste ein
 * Klick (Pane fokussieren, Tab wechseln) und kein Ziehen — der häufigere Weg
 * darf nicht gegen den selteneren verlieren. */
const DRAG_THRESHOLD_PX = 4;

/** Nicht exportiert: die Aufrufer bilden die Form strukturell ab (sie
 * übergeben ein Objektliteral an `startDrag`), ein zweiter exportierter Name
 * dafür brächte nichts — dieselbe Linie wie `ClientPoint` in
 * `useWebviewFileDrop.ts`. */
interface PaneDragSpec<TSource> {
  /** Was gezogen wird — der Hook reicht es nur durch (für die Quell-Optik)
   * und an `onDrop` zurück. */
  source: TSource;
  /** Die Panes, auf denen ein Loslassen überhaupt etwas bewirkt. BEWUSST vom
   * Aufrufer bestimmt und nicht hier hergeleitet: der Tab-Zug erlaubt nur
   * Panes desselben Projekts, der Slot-Tausch nur belegte Slots ≠ Quelle.
   * Wer nicht in dieser Liste steht, wird gar nicht erst getroffen — die
   * Ablehnung passiert beim Schweben, nicht erst beim Loslassen. */
  candidatePaneIds: readonly string[];
  onDrop: (targetPaneId: string) => void;
}

export interface PaneDrag<TSource> {
  /** An `onPointerDown` des Griffs (Pane-Header bzw. Tab-Chip). */
  startDrag: (
    event: ReactPointerEvent<HTMLElement>,
    spec: PaneDragSpec<TSource>,
  ) => void;
  /** Was gerade gezogen wird, sonst `null` — die Quelle zeigt daran ihren
   * abgesenkten Zustand. Erst gesetzt, wenn die Schwelle überschritten ist. */
  source: TSource | null;
  /** Die Pane, in der ein Loslassen JETZT landen würde, sonst `null`. */
  targetPaneId: string | null;
  /** Die beim Scharfwerden erlaubten Ziel-Panes (die `candidatePaneIds` der
   * laufenden Spec), leer außerhalb eines scharfen Zugs. Nachgereicht mit dem
   * Nutzer-Befund zum Tab-Zug ("er muss mir natürlich auch anzeigen, wo ich
   * ihn jetzt loslassen könnte"): die Ablehnungslogik wirkte bereits beim
   * Schweben, aber SICHTBAR wurde ein gültiges Ziel erst, wenn der Zeiger es
   * zufällig traf — der Aufrufer kann die Kandidaten jetzt sofort beim
   * Scharfwerden andeuten statt sie den Nutzer suchen zu lassen. */
  candidatePaneIds: readonly string[];
  /** Wo der Zeiger beim Scharfwerden stand — Startposition der
   * Zeigerplakette, sonst `null`. Alles danach schreibt der Bewegungs-Handler
   * direkt ins DOM (s. `ghostRef`), nicht in den State. */
  ghostOrigin: { x: number; y: number } | null;
  /** Die Zeigerplakette ("das habe ich in der Hand"). Bewusst ein Ref und
   * kein State-Wertepaar — exakt dieselbe Begründung wie beim Explorer-Ziehen
   * (`useExplorerPathDrag.ts`): `pointermove` feuert bei jeder Mausbewegung,
   * ein `setState` daraus würde die gesamte App pro Bewegung neu rendern.
   * Beim Umbau zum geteilten Hook war dieses Element schlicht nicht
   * mitgekommen — der Zug lief dadurch komplett unsichtbar am Zeiger vorbei
   * (Nutzer-Befund: "Ich muss erkennen können, dass ich diesen Tab jetzt in
   * der Hand habe"). */
  ghostRef: RefObject<HTMLDivElement | null>;
  /** Ob der unmittelbar folgende Klick noch zum eben beendeten Ziehen gehört
   * und deshalb verworfen werden muss. Verbraucht die Markierung. */
  consumeDragClick: () => boolean;
}

/** Trefferprüfung gegen GENAU die erlaubten Panes, bei jedem Aufruf frisch
 * gemessen (ein Template-Wechsel oder Explorer-Resize mitten im Ziehen
 * verschiebt die Rechtecke). Bewusst nicht `useWebviewFileDrop`s
 * `paneAtPoint`: das misst die Registrierung des jeweils AKTIVEN Terminal-
 * Tabs — also immer alle belegten Panes — und kennt die Ziel-Einschränkung
 * dieser Gesten nicht. */
function candidateAtPoint(
  candidatePaneIds: readonly string[],
  point: { x: number; y: number },
): string | null {
  const rects: PaneRect[] = [];
  for (const paneId of candidatePaneIds) {
    const element = document.querySelector(
      `[data-pane-id="${CSS.escape(paneId)}"]`,
    );
    if (!element) continue;
    rects.push({ paneId, rect: element.getBoundingClientRect() });
  }
  return paneIdAtPoint(rects, point);
}

const NO_CANDIDATES: readonly string[] = [];

export function usePaneDrag<TSource>(): PaneDrag<TSource> {
  const [source, setSource] = useState<TSource | null>(null);
  const [targetPaneId, setTargetPaneId] = useState<string | null>(null);
  const [candidatePaneIds, setCandidatePaneIds] =
    useState<readonly string[]>(NO_CANDIDATES);
  const [ghostOrigin, setGhostOrigin] = useState<{ x: number; y: number } | null>(
    null,
  );
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const suppressClickRef = useRef(false);

  const consumeDragClick = useCallback(() => {
    const suppress = suppressClickRef.current;
    suppressClickRef.current = false;
    return suppress;
  }, []);

  const startDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>, spec: PaneDragSpec<TSource>) => {
      // Nur die primäre Taste zieht — die sekundäre gehört den Kontextmenüs
      // (Tab-Chip, Terminalfläche), und ein mit ihr begonnenes Ziehen ließe
      // sich nur mit der linken beenden.
      if (event.button !== 0) return;
      // Ohne erlaubtes Ziel gibt es nichts zu ziehen (einzige Pane im Grid,
      // einziger Tab der Pane, kein zweites Projektfenster desselben
      // Projekts): dann bleibt die Geste ein reiner Klick.
      if (spec.candidatePaneIds.length === 0) return;

      // Defensiv zurückgesetzt (nicht nur beim Beenden gesetzt): endete ein
      // vorheriges Ziehen ohne den erwarteten Klick, verschluckte die
      // liegengebliebene Markierung sonst den nächsten echten Klick.
      suppressClickRef.current = false;

      const handle = event.currentTarget;
      const startX = event.clientX;
      const startY = event.clientY;
      let armed = false;
      let lastX = startX;
      let lastY = startY;

      // Sofort beim Drücken, nicht erst beim Scharfwerden: das Ziel liegt bei
      // dieser Geste per Definition außerhalb des Griffs, ohne Capture gingen
      // `pointermove`/`pointerup` ab dem ersten Verlassen an die Pane
      // darunter und der Vorgang endete nie. Mit Capture zielen sie weiter
      // auf den Griff — deshalb hängen die Listener unten an ihm und nicht am
      // Fenster.
      handle.setPointerCapture(event.pointerId);

      const finish = (dropped: boolean) => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onCancel);
        if (handle.hasPointerCapture(event.pointerId)) {
          handle.releasePointerCapture(event.pointerId);
        }
        if (armed) {
          // Der `pointerup` landet durch das Capture wieder am Griff und
          // erzeugt dort einen Klick — ohne diese Markierung würde jeder
          // Drop nebenbei die Quelle „anklicken" (Pane fokussieren,
          // Tab wechseln).
          suppressClickRef.current = true;
          if (dropped) {
            const hit = candidateAtPoint(spec.candidatePaneIds, {
              x: lastX,
              y: lastY,
            });
            // Über keinem erlaubten Ziel losgelassen heißt: nichts tun. Ein
            // Zug ins Leere ist ein Abbruch, keine halbe Handlung.
            if (hit !== null) spec.onDrop(hit);
          }
        }
        setSource(null);
        setTargetPaneId(null);
        setCandidatePaneIds(NO_CANDIDATES);
        setGhostOrigin(null);
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
          setSource(spec.source);
          setCandidatePaneIds(spec.candidatePaneIds);
          setGhostOrigin({ x: lastX, y: lastY });
        }
        // Direkt ans DOM statt in den State — Begründung an `ghostRef`. Die
        // Plakette ist im ersten Bild nach dem Scharfwerden noch nicht
        // gemountet; sie startet deshalb an `ghostOrigin` und wird ab hier
        // weitergeschoben. Bewusst OHNE Easing/Delay: die Plakette folgt der
        // Zeigerposition unmittelbar, alles andere fühlte sich gummiband-
        // artig an (Bewegung aus Interaktion, nie aus Easing).
        const ghost = ghostRef.current;
        if (ghost) {
          ghost.style.transform = `translate3d(${String(lastX)}px, ${String(lastY)}px, 0)`;
        }
        // React lässt identische set-Werte folgenlos verpuffen — gerendert
        // wird nur beim tatsächlichen Wechsel der Ziel-Pane, nicht pro
        // Mausbewegung.
        setTargetPaneId(candidateAtPoint(spec.candidatePaneIds, { x: lastX, y: lastY }));
      };
      const onUp = () => {
        finish(true);
      };
      const onCancel = () => {
        finish(false);
      };

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onCancel);
    },
    [],
  );

  return {
    startDrag,
    source,
    targetPaneId,
    candidatePaneIds,
    ghostOrigin,
    ghostRef,
    consumeDragClick,
  };
}
