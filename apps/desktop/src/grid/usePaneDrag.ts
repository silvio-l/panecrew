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
   * Panes desselben Projekts (seit der Präzisions-Runde einschließlich der
   * eigenen — Umsortieren), der Slot-Tausch nur belegte Slots ≠ Quelle.
   * Wer nicht in dieser Liste steht, wird gar nicht erst getroffen — die
   * Ablehnung passiert beim Schweben, nicht erst beim Loslassen. */
  candidatePaneIds: readonly string[];
  /** Optional: die POSITION innerhalb der getroffenen Pane, an der ein
   * Loslassen JETZT einsortieren würde (Nutzer-Befund "ich kann nur Drop in
   * ein Pane, aber nicht an eine ganz bestimmte Stelle"). Der Hook kennt
   * keine Tab-Leisten — WAS eine Position bedeutet und wie sie sich aus dem
   * Zeigerpunkt ergibt, weiß nur der Aufrufer; hier wird sie nur pro
   * Bewegung nachgeführt (`targetIndex`) und beim Drop mitgereicht. Ohne
   * Angabe bleibt `targetIndex` `null` (der Slot-Tausch hat keine
   * Positionen, nur ganze Panes). */
  insertionIndexAt?: (
    targetPaneId: string,
    point: { x: number; y: number },
  ) => number;
  onDrop: (targetPaneId: string, insertIndex: number | null) => void;
  /** Optional: LEERE Slots als drittes Zielangebot (Nutzer-Wunsch "wenn ich
   * ein Tab auf einen leeren Slot ziehe, wird dort ein neues Pane
   * erstellt") — als Slot-INDIZES, denn eine `paneId` existiert dort per
   * Definition noch nicht. Getroffen wird gegen `[data-empty-slot]`-Zellen
   * (`ProjectPicker.tsx`), mit derselben Frisch-Messung wie
   * `candidateAtPoint`. Ohne Angabe (Slot-Tausch) bleiben leere Slots, was
   * sie dort immer waren: kein Ziel. */
  emptySlotIndices?: readonly number[];
  /** Der Drop auf einen leeren Slot aus `emptySlotIndices` — getrennt von
   * `onDrop`, weil die Wirkung eine andere ist (Pane erzeugen statt in eine
   * bestehende einsortieren) und ein Vereinigungstyp im ersten Parameter
   * beide Aufrufer nur zum Fallunterscheiden zwänge. */
  onDropEmptySlot?: (slotIndex: number) => void;
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
  /** Die Position innerhalb dieser Pane (s. `insertionIndexAt`) — `null`,
   * wenn kein Ziel getroffen ist oder der Zug keine Positionen kennt. */
  targetIndex: number | null;
  /** Der LEERE Slot, in dem ein Loslassen JETZT landen würde (s.
   * `emptySlotIndices`), sonst `null`. Schließt sich mit `targetPaneId`
   * gegenseitig aus — ein Zeiger steht immer nur über einem von beidem. */
  targetEmptySlot: number | null;
  /** Die beim Scharfwerden erlaubten Ziel-Panes (die `candidatePaneIds` der
   * laufenden Spec), leer außerhalb eines scharfen Zugs. Nachgereicht mit dem
   * Nutzer-Befund zum Tab-Zug ("er muss mir natürlich auch anzeigen, wo ich
   * ihn jetzt loslassen könnte"): die Ablehnungslogik wirkte bereits beim
   * Schweben, aber SICHTBAR wurde ein gültiges Ziel erst, wenn der Zeiger es
   * zufällig traf — der Aufrufer kann die Kandidaten jetzt sofort beim
   * Scharfwerden andeuten statt sie den Nutzer suchen zu lassen. */
  candidatePaneIds: readonly string[];
  /** Die beim Scharfwerden erlaubten leeren Ziel-Slots (die
   * `emptySlotIndices` der laufenden Spec) — dasselbe Sofort-Andeuten wie
   * `candidatePaneIds`, nur für das dritte Zielangebot. Leer außerhalb
   * eines scharfen Zugs und bei Zügen ohne Leere-Slot-Ziele. */
  emptySlotIndices: readonly number[];
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

/** Trefferprüfung gegen die erlaubten LEEREN Slots — dieselbe Frisch-Messung
 * wie `candidateAtPoint`, nur dass die Zellen hier über ihren Slot-Index
 * adressiert sind (`data-empty-slot`, `ProjectPicker.tsx`): eine `paneId`
 * gibt es an einem leeren Slot noch nicht. */
function emptySlotAtPoint(
  emptySlotIndices: readonly number[],
  point: { x: number; y: number },
): number | null {
  for (const slotIndex of emptySlotIndices) {
    const element = document.querySelector(
      `[data-empty-slot="${String(slotIndex)}"]`,
    );
    if (!element) continue;
    const rect = element.getBoundingClientRect();
    if (
      point.x >= rect.left &&
      point.x <= rect.right &&
      point.y >= rect.top &&
      point.y <= rect.bottom
    ) {
      return slotIndex;
    }
  }
  return null;
}

const NO_CANDIDATES: readonly string[] = [];
const NO_EMPTY_SLOTS: readonly number[] = [];

export function usePaneDrag<TSource>(): PaneDrag<TSource> {
  const [source, setSource] = useState<TSource | null>(null);
  const [targetPaneId, setTargetPaneId] = useState<string | null>(null);
  const [targetIndex, setTargetIndex] = useState<number | null>(null);
  const [targetEmptySlot, setTargetEmptySlot] = useState<number | null>(null);
  const [candidatePaneIds, setCandidatePaneIds] =
    useState<readonly string[]>(NO_CANDIDATES);
  const [emptySlotIndices, setEmptySlotIndices] =
    useState<readonly number[]>(NO_EMPTY_SLOTS);
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
      // React bubbelt Portal-Inhalte (z. B. ein `ContextMenu.Content`, das
      // strukturell innerhalb dieses Griffs gerendert wird) entlang des
      // React-Baums, nicht entlang des echten DOM-Baums — ein `pointerdown`
      // auf einem Menüpunkt in `document.body` erreicht `handle` also trotzdem
      // hier. Ohne diese Prüfung fängt `setPointerCapture` unten den Zeiger
      // auf `handle` ein und der Menüpunkt bekommt sein eigenes `pointerup`
      // nie — Radix' `onSelect` feuert dann nicht (Bug 2: Kontextmenü-Klicks
      // wirkungslos). Bei echtem DOM-Bubbling ist `target` dagegen immer ein
      // Nachfahre von `currentTarget`.
      if (
        event.target instanceof Node &&
        !event.currentTarget.contains(event.target)
      ) {
        return;
      }
      // Ohne erlaubtes Ziel gibt es nichts zu ziehen (einzige Pane im Grid,
      // einziger Tab der Pane, kein zweites Projektfenster desselben
      // Projekts): dann bleibt die Geste ein reiner Klick. Ein leerer Slot
      // zählt als Ziel — der Zug "letzter Tab in einen leeren Slot" hat
      // keine einzige Kandidaten-Pane und ist trotzdem einer.
      const specEmptySlots = spec.emptySlotIndices ?? NO_EMPTY_SLOTS;
      if (spec.candidatePaneIds.length === 0 && specEmptySlots.length === 0) {
        return;
      }

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
            const point = { x: lastX, y: lastY };
            const hit = candidateAtPoint(spec.candidatePaneIds, point);
            const emptyHit =
              hit === null ? emptySlotAtPoint(specEmptySlots, point) : null;
            // Über keinem erlaubten Ziel losgelassen heißt: nichts tun. Ein
            // Zug ins Leere ist ein Abbruch, keine halbe Handlung.
            if (hit !== null) {
              spec.onDrop(hit, spec.insertionIndexAt?.(hit, point) ?? null);
            } else if (emptyHit !== null) {
              spec.onDropEmptySlot?.(emptyHit);
            }
          }
        }
        setSource(null);
        setTargetPaneId(null);
        setTargetIndex(null);
        setTargetEmptySlot(null);
        setCandidatePaneIds(NO_CANDIDATES);
        setEmptySlotIndices(NO_EMPTY_SLOTS);
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
          setEmptySlotIndices(specEmptySlots);
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
        // wird nur beim tatsächlichen Wechsel von Ziel-Pane oder
        // Einfüge-Position, nicht pro Mausbewegung.
        const point = { x: lastX, y: lastY };
        const hit = candidateAtPoint(spec.candidatePaneIds, point);
        setTargetPaneId(hit);
        setTargetIndex(
          hit !== null ? (spec.insertionIndexAt?.(hit, point) ?? null) : null,
        );
        // Panes und leere Slots überlappen sich nie (je eine Grid-Zelle) —
        // die Pane-Prüfung zuerst ist deshalb keine Vorfahrtsregel, nur eine
        // ersparte zweite Messung, wenn schon eine Pane getroffen ist.
        setTargetEmptySlot(
          hit === null ? emptySlotAtPoint(specEmptySlots, point) : null,
        );
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
    targetIndex,
    targetEmptySlot,
    candidatePaneIds,
    emptySlotIndices,
    ghostOrigin,
    ghostRef,
    consumeDragClick,
  };
}
