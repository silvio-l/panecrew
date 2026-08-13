// Weiche Grid-Zustandsübergänge (Nutzer-Direktive 2026-08-13: Template-
// Wechsel, Fokus-Modus und Slot↔Pane sollen sich "macOS und Apple anfühlen"):
// FLIP-Technik (First-Last-Invert-Play) statt animierter Grid-Spuren.
//
// Warum FLIP und nicht `transition` auf `grid-template-columns/-rows`: die
// Spuren sind nur animierbar, solange BEIDE Werte gleich viele Spuren haben —
// genau das ist bei fast jedem Template-Wechsel verletzt (Quad→Geteilt: zwei
// Zeilenspuren werden eine, der Übergang schaltet diskret). FLIP misst
// stattdessen pro Zelle das Rechteck VOR dem Klassentausch (First, der
// Schnappschuss des letzten Commits) und NACH ihm (Last, im Layout-Effekt vor
// dem Paint), und spielt die Differenz als reine `transform`-Animation ab —
// unabhängig davon, wie sich die Spuren strukturell geändert haben, und ohne
// je Layout pro Frame zu rechnen.
//
// Die PTY-Unmount-Garantie (Kopfkommentar PaneGrid.tsx / `.pc-workspace` in
// App.css) bleibt vollständig unberührt: hier wird kein Element erzeugt,
// entfernt oder umgehängt — ausschließlich WAAPI-Animationen (`el.animate`)
// auf den ohnehin vorhandenen Zellen, die Inline-Styles nie dauerhaft
// anfassen (einzige Ausnahme: ein transienter z-index während einer laufenden
// Bewegung, der beim Ende exakt auf den Vorwert zurückgesetzt wird).
//
// Drei Stimmen, je nach dem, was mit einer Zelle zwischen zwei Commits
// passiert ist:
//   1. Sichtbar → sichtbar mit anderem Rechteck: FLIP-Transform (Position +
//      Größe), ~260ms mit Apples "schnell raus, weich rein"-Auslauf — der
//      Template-Wechsel und die Fokus-Modus-Spannung selbst.
//   2. Sichtbar → `visibility: hidden` (die Nachbarzellen beim Fokus-Modus-
//      Eintritt): 150ms-Ausblende. WAAPI-Keyframes schlagen Inline-Styles,
//      solange die Animation läuft — das `visibility: "visible"` in beiden
//      Keyframes hält die Zelle also genau für die Dauer der Blende sichtbar,
//      danach greift Reacts Inline-`hidden` von selbst.
//   3. `hidden` → sichtbar (Fokus-Modus-Austritt): 150ms-Einblende.
//
// Frisch GEMOUNTETE Zellen (Projekt zugewiesen: Picker→Pane; Pane
// geschlossen: Pane→Picker) haben keinen First-Schnappschuss und werden hier
// bewusst übersprungen — ihren Auftritt spielt die CSS-Animation
// `pc-cell-in` an `.pc-workspace > *` (App.css), dem etablierten
// Nur-Einwärts-Muster der Overlays folgend (`pc-overlay-in`-Kommentar dort).
//
// `prefers-reduced-motion: reduce` schaltet alles hier ab (die CSS-Seite
// steckt in ihrer eigenen Media-Query); jsdom ohne `Element.animate` ebenso —
// die Tests sehen exakt den unanimierten DOM.
import { useLayoutEffect, useRef, type RefObject } from "react";
import type { TemplateId } from "./gridState";

/** Apples typischer Fenster-Zoom-Auslauf: schnell los, weich ankommen. */
const FLIP_EASING = "cubic-bezier(0.2, 0, 0, 1)";
const FLIP_DURATION_MS = 260;
const FADE_DURATION_MS = 150;

interface CellSnapshot {
  el: HTMLElement;
  rect: DOMRect;
  hidden: boolean;
}

function animationsUsable(): boolean {
  // jsdom (Vitest) hat kein WAAPI — der Hook wird dort zum reinen No-Op,
  // die DOM-Struktur bleibt für jede Assertion identisch zur echten App.
  if (typeof HTMLElement.prototype.animate !== "function") return false;
  // jsdom hat auch matchMedia nicht (s. applyTheme.test.ts) — deshalb der
  // Funktions-Check statt eines Direktaufrufs.
  if (typeof window.matchMedia !== "function") return true;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Kinder des Arbeitsraums in Slot-Reihenfolge vermessen — die DOM-Reihenfolge
 * IST die Slot-Reihenfolge (Invariante des flachen Zellen-Arrays,
 * PaneGrid.tsx), `cellKeys[i]` gehört also zu `children[i]`. */
function snapshotCells(
  workspace: HTMLElement,
  cellKeys: readonly string[],
): Map<string, CellSnapshot> {
  const cells = new Map<string, CellSnapshot>();
  Array.from(workspace.children).forEach((child, index) => {
    const key = cellKeys[index];
    if (key === undefined || !(child instanceof HTMLElement)) return;
    cells.set(key, {
      el: child,
      rect: child.getBoundingClientRect(),
      hidden: child.style.visibility === "hidden",
    });
  });
  return cells;
}

function startCellAnimation(
  el: HTMLElement,
  prev: CellSnapshot,
  now: CellSnapshot,
): Animation | null {
  if (!prev.hidden && now.hidden) {
    return el.animate(
      [
        { opacity: 1, visibility: "visible" },
        { opacity: 0, visibility: "visible" },
      ],
      { duration: FADE_DURATION_MS, easing: "ease-out" },
    );
  }
  if (prev.hidden && !now.hidden) {
    return el.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: FADE_DURATION_MS,
      easing: "ease-out",
    });
  }
  if (now.hidden) return null;

  // Degenerierte Rechtecke (Zelle noch ohne Layout) ergäben NaN/Infinity in
  // den Skalierungsfaktoren — dann lieber gar keine Bewegung.
  if (
    prev.rect.width <= 0 ||
    prev.rect.height <= 0 ||
    now.rect.width <= 0 ||
    now.rect.height <= 0
  ) {
    return null;
  }

  const dx = prev.rect.left - now.rect.left;
  const dy = prev.rect.top - now.rect.top;
  const sx = prev.rect.width / now.rect.width;
  const sy = prev.rect.height / now.rect.height;
  if (
    Math.abs(dx) < 0.5 &&
    Math.abs(dy) < 0.5 &&
    Math.abs(sx - 1) < 0.005 &&
    Math.abs(sy - 1) < 0.005
  ) {
    return null;
  }

  // Eine Zelle in Bewegung liegt ÜBER den ruhenden (die aus dem Fokus-Modus
  // zurückschrumpfende Pane gleitet sonst UNTER später gerenderten
  // Geschwistern hindurch). Nur setzen, wenn kein eigener z-index steht — die
  // maximierte Zelle bringt ihre 30 als React-Inline-Style selbst mit, und
  // die darf nicht überschrieben werden, weil React sie beim nächsten Render
  // als unverändert ansähe und nie zurückschriebe.
  const transientZIndex = el.style.zIndex === "";
  if (transientZIndex) el.style.zIndex = "20";
  const restore = () => {
    if (transientZIndex) el.style.zIndex = "";
  };

  // Origin oben links in beiden Keyframes: nur damit bildet
  // `translate(dx, dy) scale(sx, sy)` das neue Rechteck exakt auf das alte ab.
  const animation = el.animate(
    [
      {
        transformOrigin: "0 0",
        transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
      },
      { transformOrigin: "0 0", transform: "translate(0px, 0px) scale(1, 1)" },
    ],
    { duration: FLIP_DURATION_MS, easing: FLIP_EASING },
  );
  animation.addEventListener("finish", restore);
  animation.addEventListener("cancel", restore);
  return animation;
}

/**
 * Animiert die Zellen von `workspaceRef` bei jedem Wechsel von `template`
 * oder `maximizedPaneId` von ihrem alten zu ihrem neuen Rechteck. Andere
 * Renders (Fokuswechsel, Tab-Wechsel, Slot-Belegung) aktualisieren nur die
 * Schnappschüsse und animieren nichts — sonst „flösse" das Grid bei jedem
 * beliebigen Re-Render, sobald sich nebenbei die Fenstergröße geändert hat.
 */
export function useGridTransitions(
  workspaceRef: RefObject<HTMLElement | null>,
  cellKeys: readonly string[],
  template: TemplateId,
  maximizedPaneId: string | null,
): void {
  const trigger = `${template}|${maximizedPaneId ?? ""}`;
  const prevCells = useRef<ReadonlyMap<string, CellSnapshot>>(new Map());
  const prevTrigger = useRef(trigger);
  const running = useRef(new Map<string, Animation>());
  // Für den Resize-Listener unten: immer die Schlüssel des LETZTEN Commits —
  // im Haupteffekt nachgeführt (nicht im Render, Refs sind dort tabu).
  const latestKeys = useRef(cellKeys);

  // Bewusst ohne Dependency-Array: die Schnappschüsse müssen NACH JEDEM
  // Commit frisch sein, sonst startete der nächste FLIP von einem Rechteck,
  // das es so nicht mehr gibt.
  useLayoutEffect(() => {
    latestKeys.current = cellKeys;
    const workspace = workspaceRef.current;
    if (!workspace) return;

    const shouldAnimate = trigger !== prevTrigger.current && animationsUsable();
    prevTrigger.current = trigger;

    const next = snapshotCells(workspace, cellKeys);

    if (shouldAnimate) {
      for (const [key, snap] of next) {
        const prev = prevCells.current.get(key);
        // Frisch gemountete Zelle: kein First-Rechteck — `pc-cell-in`
        // (App.css) übernimmt ihren Auftritt.
        if (!prev) continue;
        // Eine noch laufende Bewegung derselben Zelle bricht sauber ab
        // (inkl. z-index-Rückgabe über ihren cancel-Listener), bevor die
        // neue startet — schnelles Durchschalten der Templates stapelt
        // sonst Transformationen.
        running.current.get(key)?.cancel();
        running.current.delete(key);

        const animation = startCellAnimation(snap.el, prev, snap);
        if (animation) {
          running.current.set(key, animation);
          animation.addEventListener("finish", () => {
            if (running.current.get(key) === animation) {
              running.current.delete(key);
            }
          });
        }
      }
    }

    prevCells.current = next;
  });

  // Eine reine Fenstergrößen-Änderung rendert dieses Grid nicht neu — die
  // Schnappschüsse wären danach veraltet, und der nächste Template-Wechsel
  // spielte seinen FLIP von den alten, falschen Rechtecken aus. Deshalb nach
  // jedem Resize einmal frisch vermessen.
  useLayoutEffect(() => {
    const refresh = () => {
      const workspace = workspaceRef.current;
      if (!workspace) return;
      prevCells.current = snapshotCells(workspace, latestKeys.current);
    };
    window.addEventListener("resize", refresh);
    return () => window.removeEventListener("resize", refresh);
  }, [workspaceRef]);
}
