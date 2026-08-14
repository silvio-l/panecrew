import { useEffect, useRef } from "react";
import type { GridState, TemplateId } from "../grid/gridState";
import {
  busRoutePoints,
  chamferedLength,
  chamferedPathD,
  traceDurationMs,
  TRACE_CHAMFER_PX,
  TRACE_PAD_HEIGHT_PX,
  TRACE_PAD_WIDTH_PX,
} from "./traceGeometry";

// Die permanente Fokus-Leiterbahn (PCB-Metapher "PaneCrew ist eine Platine"):
// zu jedem Zeitpunkt ist genau EINE Route sichtbar bestromt — vom aktiven Pin
// des Pin-Headers an der Explorer-Naht (FocusPinHeader.tsx) entlang der
// Kanäle zwischen den Grid-Hairlines bis zu einem Pad auf der Oberkante der
// fokussierten Pane. Sie ERGÄNZT den bestehenden Fokus-Rahmen (macht dessen
// Ursprung als Leitung sichtbar), konkurriert aber nicht mit ihm: flacher
// 2px-Strich im selben Akzent-Token, kein Glow (Design-Kanon), keine eigene
// Farbe. Bei jedem Fokuswechsel zeichnet sich die Leitung mit
// Signal-Laufzeit-Optik neu zum neuen Ziel (Dauer proportional zur Weglänge,
// traceGeometry.ts); die alte verschwindet dabei einfach — Make-before-break/
// Doppel-Leiten war ein separat VERWORFENER Ideenteil.
//
// Rendert als pointer-events-loses SVG-Overlay über dem gemeinsamen
// `position:relative`-Container von Explorer + Separator + <main> (App.tsx) —
// es gibt kein bestehendes Cross-Komponenten-Overlay-Muster in dieser
// Codebase, wohl aber die Rect-Konvention, auf der das hier aufsetzt:
// Laufzeit-Messung über `[data-pane-id]`-Attribute per getBoundingClientRect
// (Präzedenzfall `useWebviewFileDrop.ts`, `paneAtPoint`; der Pin trägt analog
// `data-pin-pane-id`). Pfad, Pad und Animation werden imperativ am
// SVG-Element gesetzt statt über React-State — ein ResizeObserver-Callback
// pro Resize-Frame darf keine Re-Render-Kaskade auslösen, während in den
// Panes PTYs streamen (dasselbe ref-basierte Direkt-DOM-Muster wie der
// Drag-Ghost in `useExplorerPathDrag.ts`).
export function FocusTrace({
  focusedPaneId,
  template,
  slots,
  maximizedPaneId,
}: {
  focusedPaneId: string | null;
  /** Nur Neuzeichnen-Trigger: ein Template-Wechsel verschiebt die Rechtecke,
   * ohne dass sich `focusedPaneId` ändert. */
  template: TemplateId;
  /** Ebenfalls nur Trigger — Panes öffnen/schließen verschiebt Pins und
   * Zellen. Der Inhalt wird nicht gelesen, die Identität genügt. */
  slots: GridState["slots"];
  maximizedPaneId: string | null;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const padRef = useRef<SVGRectElement>(null);
  const animationRef = useRef<Animation | null>(null);
  const prevFocusedRef = useRef<string | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    const path = pathRef.current;
    const pad = padRef.current;
    if (!svg || !path || !pad) return;

    const hide = () => {
      path.removeAttribute("d");
      pad.setAttribute("display", "none");
    };

    // Misst Pin, Ziel-Pane und Grid-Kante frisch und schreibt Route + Pad
    // direkt ans SVG. `animate` nur beim Fokuswechsel — reine
    // Geometrie-Updates (Resize, Template, Selbstkorrektur-Takt) zeichnen
    // sofort fertig, sonst spielte jeder Explorer-Resize-Frame die
    // Aufbau-Animation neu an.
    //
    // Idempotent (Fix 2026-08-14, „Leiterbahn läuft durch den Pane-Header"):
    // erst rechnen, nur bei tatsächlich geänderter Geometrie schreiben. Damit
    // ist jeder stille Nachzieh-Anlass (settle, Observer, Takt) gratis und
    // bricht insbesondere nie eine gerade laufende Aufbau-Animation ab —
    // die Voraussetzung dafür, dass unten großzügig nachgemessen werden darf.
    const draw = (animate: boolean): Element | null => {
      if (focusedPaneId === null) {
        animationRef.current?.cancel();
        animationRef.current = null;
        hide();
        return null;
      }
      const pinEl = document.querySelector(
        `[data-pin-pane-id="${CSS.escape(focusedPaneId)}"]`,
      );
      // Mehrere Mounts tragen dieselbe `data-pane-id` (ein `<section>` je
      // Terminal-Tab, PaneGrid.tsx) — sie liegen `absolute inset-0`
      // übereinander, das erste Match misst dieselbe Zelle wie jedes andere.
      const paneEl = document.querySelector(
        `[data-pane-id="${CSS.escape(focusedPaneId)}"]`,
      );
      const workspaceEl = document.querySelector(".pc-workspace");
      if (!pinEl || !paneEl || !workspaceEl) {
        animationRef.current?.cancel();
        animationRef.current = null;
        hide();
        return null;
      }
      const origin = svg.getBoundingClientRect();
      const pinRect = pinEl.getBoundingClientRect();
      const paneRect = paneEl.getBoundingClientRect();
      if (paneRect.width <= 0 || paneRect.height <= 0) {
        animationRef.current?.cancel();
        animationRef.current = null;
        hide();
        return paneEl;
      }

      const points = busRoutePoints({
        pin: {
          x: pinRect.left + pinRect.width / 2 - origin.left,
          y: pinRect.top + pinRect.height / 2 - origin.top,
        },
        paneLeft: paneRect.left - origin.left,
        paneTop: paneRect.top - origin.top,
        paneWidth: paneRect.width,
        workspaceLeft:
          workspaceEl.getBoundingClientRect().left - origin.left,
      });
      const end = points[points.length - 1];
      if (!end) {
        animationRef.current?.cancel();
        animationRef.current = null;
        hide();
        return paneEl;
      }
      const d = chamferedPathD(points, TRACE_CHAMFER_PX);
      const padX = String(end.x - TRACE_PAD_WIDTH_PX / 2);
      const padY = String(end.y - TRACE_PAD_HEIGHT_PX);
      const unchanged =
        path.getAttribute("d") === d &&
        pad.getAttribute("x") === padX &&
        pad.getAttribute("y") === padY &&
        !pad.hasAttribute("display");
      if (unchanged && !animate) return paneEl;

      animationRef.current?.cancel();
      animationRef.current = null;
      path.setAttribute("d", d);
      // Ganz oberhalb der Kante, nicht mittig auf ihr: mittig geviertelt der
      // 4px-Pad von der 1px-Border praktisch unsichtbar (optisch geprüft,
      // Harness-Screenshot) — als Knubbel VOR der Kante bleibt er ein eigenes
      // Bauteil statt in der Linie zu verschwinden.
      pad.setAttribute("x", padX);
      pad.setAttribute("y", padY);
      pad.removeAttribute("display");

      // Aufbau über stroke-dasharray/-dashoffset am Pfad selbst (WAAPI wie
      // `useGridTransitions.ts`) — Basiszustand ist die fertige Leitung, die
      // Animation läuft nur darüber und lässt beim Ende nichts zurück.
      const length = chamferedLength(points, TRACE_CHAMFER_PX);
      path.style.strokeDasharray = `${length}`;
      path.style.strokeDashoffset = "0";
      if (animate && length > 0 && traceAnimatable(path)) {
        animationRef.current = path.animate(
          [{ strokeDashoffset: `${length}` }, { strokeDashoffset: "0" }],
          // Linear, nicht geeast: die Signal-Laufzeit-Optik lebt von
          // konstanter Ausbreitungsgeschwindigkeit (2px/ms,
          // traceGeometry.ts), ein Easing wäre genau die Bewegung aus
          // Kurven statt aus Dauer, gegen die der Motion-Kanon steht.
          { duration: traceDurationMs(length), easing: "linear" },
        );
      }
      return paneEl;
    };

    const shouldAnimate = focusedPaneId !== prevFocusedRef.current;
    prevFocusedRef.current = focusedPaneId;
    let observedEl = draw(shouldAnimate);

    // Template-/Fokus-Modus-Wechsel bewegen die Zellen über eine 260ms-FLIP-
    // Transform-Animation (useGridTransitions.ts), und getBoundingClientRect
    // liest Transforms MIT — die Sofort-Messung oben trifft dann einen
    // Zwischenstand. Einmal nach deren Ausklang still nachziehen.
    const settle = window.setTimeout(() => draw(false), 320);

    // Explorer-Resize, Fenster-Resize und Template-Geometrie ändern alle die
    // GRÖSSE der Ziel-Pane (fluides fr-Grid) — ein Observer auf genau diesem
    // Element deckt sie gemeinsam ab, ohne ein window-Resize-Listener-Paar
    // pflegen zu müssen. Der Erst-Callback (feuert bei observe() immer) läuft
    // seit dem Idempotenz-Umbau bewusst MIT: normalerweise ein No-Op, aber
    // hat sich das Layout zwischen Sofort-Messung und Erst-Zustellung noch
    // bewegt (Kaltstart-Jank, Session-Restore mit mehreren PTY-Spawns), steckt
    // die Korrektur genau in dieser sonst verschluckten Zustellung.
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver === "function") {
      observer = new ResizeObserver(() => draw(false));
      if (observedEl !== null) observer.observe(observedEl);
    }

    // Selbstkorrektur-Takt, der eigentliche Fix hinter dem Befund „Leiterbahn
    // läuft durch den Pane-Header/Breadcrumb" (2026-08-14): settle + Observer
    // decken NICHT jede Geometrieänderung ab. Zwei nachgewiesene Löcher:
    // (a) Positionswechsel ohne Größenänderung — der größengleiche
    //     Slot-Tausch, dessen FLIP-Transform die 320ms-settle-Messung unter
    //     Last überdauern kann; der ResizeObserver schweigt dazu prinzipbedingt.
    // (b) Der beobachtete Knoten stirbt (React-Remount, in der Dev-Instanz
    //     v. a. via HMR) — ein ResizeObserver auf einem ausgehängten Element
    //     feuert nie wieder, jede spätere Layout-Änderung liefe ins Leere
    //     (im Headless-Chrome reproduziert: dauerhaft ~125px Abweichung).
    // Ein 1s-Takt misst nach (2 querySelector + 4 Rects, Schreiben nur bei
    // Differenz — im Normalfall also reine Lesearbeit ohne Style-Invalidation)
    // und hängt den Observer um, wenn das erste `[data-pane-id]`-Match nicht
    // mehr der beobachtete Knoten ist. Kein rAF-Dauerlauf: der Takt ist die
    // Rückfallebene, die schnellen Wege oben bleiben zuständig.
    const verify = window.setInterval(() => {
      const el = draw(false);
      if (el !== observedEl && observer !== null) {
        observer.disconnect();
        if (el !== null) observer.observe(el);
      }
      observedEl = el;
    }, 1000);

    return () => {
      window.clearTimeout(settle);
      window.clearInterval(verify);
      observer?.disconnect();
      animationRef.current?.cancel();
      animationRef.current = null;
    };
  }, [focusedPaneId, template, slots, maximizedPaneId]);

  return (
    // z-20: über dem Resize-Separator (z-10), damit die Leitung die Naht
    // sichtbar quert; pointer-events-none, die Flächen darunter bleiben voll
    // bedienbar.
    <svg
      ref={svgRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-20 h-full w-full"
    >
      <path
        ref={pathRef}
        fill="none"
        stroke="var(--pc-pane-activeBorder)"
        strokeWidth="2"
        strokeLinecap="butt"
        strokeLinejoin="miter"
      />
      <rect
        ref={padRef}
        display="none"
        width={TRACE_PAD_WIDTH_PX}
        height={TRACE_PAD_HEIGHT_PX}
        fill="var(--pc-pane-activeBorder)"
      />
    </svg>
  );
}

// Dasselbe Doppel-Gate wie `animationsUsable` in useGridTransitions.ts (dort
// nicht exportiert, bewusst grid-lokal): jsdom hat weder WAAPI noch
// matchMedia, und `prefers-reduced-motion: reduce` lässt die Leitung sofort
// fertig erscheinen statt sie aufzubauen.
function traceAnimatable(el: SVGPathElement): boolean {
  if (typeof el.animate !== "function") return false;
  if (typeof window.matchMedia !== "function") return true;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
