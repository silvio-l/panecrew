import {
  useLayoutEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import { trackShape, type TemplateId } from "../grid/gridState";
import {
  columnRatios,
  effectiveRatios,
  ratioLength,
  resizeAxisRatios,
  rowRatios,
  splitterOffsetsPx,
  withColumnRatios,
  withRowRatios,
  type SplitAxis,
} from "../grid/splitRatios";

/** Kein Slot darf unter dieses Maß schrumpfen (Ticket 21, Akzeptanzkriterium
 * "Kein Slot schrumpft unter ein 320px-Mindestmaß") — identischer Wert für
 * Pointer-Drag UND Pfeiltasten (`resizeAxisRatios` klammert beide Wege
 * gleich). */
const MIN_SLOT_PX = 320;
/** Pfeiltasten-Schritt, Shift für den groben Schritt — dieselben zwei Stufen
 * wie `App.tsx`s `nudgeExplorerWidth`. */
const KEYBOARD_STEP_PX = 8;
const KEYBOARD_STEP_PX_COARSE = 32;
/** Trefferbreite/-höhe der Schnittkante — derselbe Wert wie der
 * Explorer-Resize-Handle (`App.tsx`, `w-[5px]`). */
const SPLITTER_THICKNESS_PX = 5;

interface GridSplittersProps {
  template: TemplateId;
  /** Roh aus `GridState.splitRatios` — leer heißt "Template-Default", von
   * `effectiveRatios` innen aufgelöst (dieselbe Semantik wie
   * `PersistedWindow.split_ratios`). */
  splitRatios: readonly number[];
  /** Schreibt die COMMITTETEN Anteile zurück (`useGrid.ts`s `setSplitRatios`)
   * — während eines Pointer-Drags ruft diese Komponente das bewusst NUR
   * einmal auf, beim Loslassen (`startDrag`s `onUp`), nicht bei jeder
   * Zeigerbewegung: `App.tsx`s Autosave-Effekt hängt am ganzen `gridState`
   * und würde sonst bei jedem Frame eine `session_save_window`-IPC auslösen
   * — derselbe Grund, aus dem der Explorer-Resize-Handle `explorerWidth`
   * (live) von `persistedExplorerWidth` (nur bei `pointerup`) trennt. Die
   * Pfeiltasten committen dagegen sofort je Tastendruck, wie
   * `nudgeExplorerWidth` es für die Explorer-Breite ebenfalls tut — ein
   * Tastendruck ist bereits diskret, kein Zwischenzustand nötig. */
  onChange: (ratios: readonly number[]) => void;
  /** `.pc-workspace`s eigener Ref (`PaneGrid.tsx`) — diese Komponente rendert
   * als sein GESCHWISTER (nie als Kind, s. `PaneGrid.tsx`s Kopfkommentar zur
   * DOM-Reihenfolge-Invariante), braucht aber seine reale Pixelgröße für die
   * Positions-/Resize-Mathematik. */
  workspaceRef: RefObject<HTMLDivElement | null>;
}

/** Schnittkanten-Splitter (Ticket 21): eine per Pointer-Drag/Pfeiltasten
 * verschiebbare Grenze je benachbartem Track-Paar eines Templates, gerendert
 * als Geschwister von `.pc-workspace` (`PaneGrid.tsx`). Positions- UND
 * Resize-Mathematik leben vollständig in `grid/splitRatios.ts` als reine
 * Pixel-Funktionen — diese Komponente misst nur EINMAL pro Layout-Änderung
 * (`ResizeObserver` auf `workspaceRef`) und reicht die Zahlen durch, dieselbe
 * Arbeitsteilung wie `FocusTrace.tsx`s Overlay. */
export function GridSplitters({
  template,
  splitRatios,
  onChange,
  workspaceRef,
}: GridSplittersProps) {
  const { t } = useTranslation();
  const { columns, rows } = trackShape(template);
  const [container, setContainer] = useState({ width: 0, height: 0, gapPx: 8 });
  // Sichtbarer Zwischenstand eines laufenden Pointer-Drags — `null` außerhalb
  // eines Drags, dann zählt allein `splitRatios` (der committete Stand). Der
  // Kommentar an `onChange` oben begründet die Trennung.
  const [liveRatios, setLiveRatios] = useState<readonly number[] | null>(null);

  useLayoutEffect(() => {
    const el = workspaceRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const gapPx = parseFloat(getComputedStyle(el).columnGap || "0") || 0;
      setContainer({ width: rect.width, height: rect.height, gapPx });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [workspaceRef]);

  if (ratioLength(columns, rows) === 0) return null;

  const committed = effectiveRatios(splitRatios, columns, rows);
  const ratios = liveRatios ?? committed;
  const offsets = splitterOffsetsPx(
    ratios,
    columns,
    rows,
    container.width,
    container.height,
    container.gapPx,
  );
  const availablePx: Record<SplitAxis, number> = {
    columns: columns > 1 ? container.width - container.gapPx * (columns - 1) : 0,
    rows: rows > 1 ? container.height - container.gapPx * (rows - 1) : 0,
  };

  // `two-over-one`/`one-over-two` (`templateGlyph.css`): die dritte Zelle
  // spannt eine ganze Zeile über beide Spalten. Die Spalten-Schnittkante darf
  // deshalb nur über der NICHT spannenden Zeile liegen — sonst läge sie über
  // der gespannten Zelle und schnitte ihr Pointer-Events weg, ohne dort
  // irgendetwas zu verstellen (es gibt in dieser Zeile keine zweite Spalte).
  const columnSplitterExtent: [number, number] =
    template === "two-over-one"
      ? [0, offsets.rows[0] ?? container.height]
      : template === "one-over-two"
        ? [offsets.rows[0] ?? 0, container.height]
        : [0, container.height];

  const startDrag =
    (axis: SplitAxis, boundaryIndex: number) => (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const handle = e.currentTarget;
      const axisAvailablePx = availablePx[axis];
      const startPos = axis === "columns" ? e.clientX : e.clientY;
      const startAxisRatios =
        axis === "columns" ? columnRatios(committed, columns) : rowRatios(committed, columns, rows);
      const merge = (next: readonly number[]) =>
        axis === "columns"
          ? withColumnRatios(committed, columns, rows, next)
          : withRowRatios(committed, columns, next);
      handle.setPointerCapture(e.pointerId);
      const onMove = (ev: PointerEvent) => {
        const pos = axis === "columns" ? ev.clientX : ev.clientY;
        const nextAxisRatios = resizeAxisRatios(
          startAxisRatios,
          boundaryIndex,
          pos - startPos,
          axisAvailablePx,
          MIN_SLOT_PX,
        );
        setLiveRatios(merge(nextAxisRatios));
      };
      const onUp = () => {
        setLiveRatios((current) => {
          if (current !== null) onChange(current);
          return null;
        });
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    };

  const nudge =
    (axis: SplitAxis, boundaryIndex: number) => (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const forwardKey = axis === "columns" ? "ArrowRight" : "ArrowDown";
      const backwardKey = axis === "columns" ? "ArrowLeft" : "ArrowUp";
      const step = e.shiftKey ? KEYBOARD_STEP_PX_COARSE : KEYBOARD_STEP_PX;
      const delta = e.key === forwardKey ? step : e.key === backwardKey ? -step : 0;
      if (delta === 0) return;
      e.preventDefault();
      const axisRatios = axis === "columns" ? columnRatios(committed, columns) : rowRatios(committed, columns, rows);
      const nextAxisRatios = resizeAxisRatios(
        axisRatios,
        boundaryIndex,
        delta,
        availablePx[axis],
        MIN_SLOT_PX,
      );
      onChange(
        axis === "columns"
          ? withColumnRatios(committed, columns, rows, nextAxisRatios)
          : withRowRatios(committed, columns, nextAxisRatios),
      );
    };

  const resetAll = () => onChange([]);

  const colRatios = columnRatios(ratios, columns);
  const rowRatiosList = rowRatios(ratios, columns, rows);

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {offsets.columns.map((left, i) => (
        <div
          key={`col-${i}`}
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label={t("gridSplitters.columnAria", { left: i + 1, right: i + 2 })}
          aria-valuenow={Math.round((colRatios[i] ?? 0) * availablePx.columns)}
          aria-valuemin={MIN_SLOT_PX}
          aria-valuemax={Math.round(availablePx.columns - MIN_SLOT_PX)}
          onPointerDown={startDrag("columns", i)}
          onDoubleClick={resetAll}
          onKeyDown={nudge("columns", i)}
          style={{
            left: left - SPLITTER_THICKNESS_PX / 2,
            top: columnSplitterExtent[0],
            height: columnSplitterExtent[1] - columnSplitterExtent[0],
            width: SPLITTER_THICKNESS_PX,
          }}
          className="pointer-events-auto absolute cursor-col-resize bg-transparent transition-colors duration-150 hover:bg-(--pc-focusBorder)/45 focus-visible:bg-(--pc-focusBorder) focus-visible:outline-none"
        />
      ))}
      {offsets.rows.map((top, i) => (
        <div
          key={`row-${i}`}
          role="separator"
          tabIndex={0}
          aria-orientation="horizontal"
          aria-label={t("gridSplitters.rowAria", { top: i + 1, bottom: i + 2 })}
          aria-valuenow={Math.round((rowRatiosList[i] ?? 0) * availablePx.rows)}
          aria-valuemin={MIN_SLOT_PX}
          aria-valuemax={Math.round(availablePx.rows - MIN_SLOT_PX)}
          onPointerDown={startDrag("rows", i)}
          onDoubleClick={resetAll}
          onKeyDown={nudge("rows", i)}
          style={{
            top: top - SPLITTER_THICKNESS_PX / 2,
            left: 0,
            width: container.width,
            height: SPLITTER_THICKNESS_PX,
          }}
          className="pointer-events-auto absolute cursor-row-resize bg-transparent transition-colors duration-150 hover:bg-(--pc-focusBorder)/45 focus-visible:bg-(--pc-focusBorder) focus-visible:outline-none"
        />
      ))}
    </div>
  );
}
