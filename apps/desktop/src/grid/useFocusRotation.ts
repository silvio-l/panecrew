import { useCallback, useEffect, useState } from "react";

// Reiner Timer-Hook für den Rotationsmodus (Ticket 19) — kein Tauri-, kein
// DOM-Zugriff, dieselbe Trennung wie `gridState.ts` selbst: die Regeln stehen
// hier, das Verdrahten (Escape/Klick/Eingabe stoppt sie) übernimmt `App.tsx`.
//
// "Stoppt", nicht "pausiert" (Spec-Wortlaut): jede Eingabe in der sichtbaren
// Pane beendet die Rotation vollständig statt sie nur auszusetzen — ein
// erneuter Start ist ein bewusster zweiter Klick, kein automatisches
// Wiederaufnehmen nach einer Tippause, das den Nutzer mitten im Tippen
// überraschen könnte.
//
// Rotationseinheit ist der Terminal-TAB, nicht die Pane (Nutzer-Korrektur
// 2026-08-13: "geht von Pane zu Pane und innerhalb der Pane erst immer alle
// Terminals von 1 bis N durch") — die Sequenz ist also die Verkettung aller
// Panes' Tab-Listen in Template-Reihenfolge, eine Pane mit nur einem Tab
// liefert einen einzelnen Eintrag darin. Eine einzelne Pane mit ≥2 Tabs kann
// dadurch bereits allein rotieren, auch ohne eine zweite belegte Pane.
export const ROTATION_INTERVALS_MS = [5000, 8000, 15000, 30000] as const;
export type RotationIntervalMs = (typeof ROTATION_INTERVALS_MS)[number];

const DEFAULT_INTERVAL_MS: RotationIntervalMs = 8000;

/** Eine Pane mit ihren Terminal-Tabs in Anzeige-Reihenfolge — alles, was die
 * Rotation braucht, um pro Pane von Tab 1 bis Tab N durchzugehen, bevor sie
 * zur nächsten Pane weiterschaltet. */
export interface RotationPane {
  paneId: string;
  tabIds: readonly string[];
}

/** Ein Schritt der Rotation: welche Pane maximiert wird UND welcher ihrer
 * Tabs dabei aktiv sein soll — `App.tsx` reicht beides 1:1 an
 * `enterFocusMode`/`switchToTerminalTab` weiter. */
export interface RotationStep {
  paneId: string;
  tabId: string;
}

export interface FocusRotation {
  active: boolean;
  intervalMs: RotationIntervalMs;
  /** Start/Stopp — der Klick auf den Rotations-Punkt im HUD. */
  toggle: () => void;
  /** Wechselt zum nächsten Preset in `ROTATION_INTERVALS_MS`, rundum. */
  cycleInterval: () => void;
  /** Von `App.tsx` bei JEDER Tastatur-/Zeigereingabe in der sichtbaren Pane
   * aufzurufen, solange Rotation aktiv ist — No-Op sonst. */
  notifyInput: () => void;
}

function flatten(panes: readonly RotationPane[]): RotationStep[] {
  return panes.flatMap((pane) => pane.tabIds.map((tabId) => ({ paneId: pane.paneId, tabId })));
}

/**
 * `onRotate` bekommt Pane UND Tab, zu denen als Nächstes gewechselt wird.
 * `occupiedPanesInOrder` ist die Reihenfolge der aktuell belegten Slots
 * (Template-Reihenfolge, nicht Erzeugungsreihenfolge) mitsamt ihrer
 * Tab-Listen — Rotation schaltet in der daraus abgeleiteten Pane×Tab-Folge
 * reihum weiter, beginnend beim aktuell aktiven Schritt
 * (`maximizedPaneId`/`activeTabId`).
 */
export function useFocusRotation({
  maximizedPaneId,
  activeTabId,
  occupiedPanesInOrder,
  onRotate,
  initialActive = false,
  initialIntervalMs = DEFAULT_INTERVAL_MS,
  onConfigChange,
}: {
  maximizedPaneId: string | null;
  /** Der im Moment aktive Terminal-Tab der maximierten Pane — bestimmt, an
   * welcher Stelle INNERHALB von deren Tab-Liste die Rotation gerade steht.
   * `null` außerhalb des Fokus-Modus (dann läuft ohnehin keine Rotation). */
  activeTabId: string | null;
  occupiedPanesInOrder: readonly RotationPane[];
  onRotate: (next: RotationStep) => void;
  /** Wiederhergestellter Zustand (Ticket 19: über `session.json` v2
   * persistiert) — nur beim ersten Render gelesen, wie bei jedem
   * `useState`-Initialwert. */
  initialActive?: boolean;
  initialIntervalMs?: RotationIntervalMs;
  /** Meldet jede Änderung an `active`/`intervalMs` zurück, damit `App.tsx`
   * sie in denselben Autosave-Effekt aufnehmen kann, der auch den übrigen
   * Grid-Zustand schreibt. */
  onConfigChange?: (config: { active: boolean; intervalMs: RotationIntervalMs }) => void;
}): FocusRotation {
  const [active, setActive] = useState(initialActive);
  const [intervalMs, setIntervalMs] = useState<RotationIntervalMs>(initialIntervalMs);

  useEffect(() => {
    onConfigChange?.({ active, intervalMs });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, intervalMs]);

  // Rotation ergibt nur im Fokus-Modus einen Sinn — ein Verlassen (ESC,
  // Schließen der maximierten Pane) räumt sie mit auf, statt sie im
  // Hintergrund weiterlaufen und beim nächsten Fokus-Modus-Eintritt
  // überraschend wieder anspringen zu lassen. Angepasst WÄHREND des Renderns
  // (React-empfohlenes Muster für „Zustand bei Prop-Änderung zurücksetzen"),
  // nicht in einem Effekt — ein `setState` synchron im Effekt-Body verursacht
  // sonst einen unnötigen zweiten Render-Durchlauf
  // (react-hooks/set-state-in-effect).
  const [lastMaximizedPaneId, setLastMaximizedPaneId] = useState(maximizedPaneId);
  if (maximizedPaneId !== lastMaximizedPaneId) {
    setLastMaximizedPaneId(maximizedPaneId);
    if (maximizedPaneId === null && active) setActive(false);
  }

  useEffect(() => {
    if (!active || maximizedPaneId === null) return;
    const sequence = flatten(occupiedPanesInOrder);
    if (sequence.length < 2) return;
    const timer = window.setInterval(() => {
      const currentIndex = sequence.findIndex(
        (step) => step.paneId === maximizedPaneId && step.tabId === activeTabId,
      );
      const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % sequence.length;
      const next = sequence[nextIndex];
      if (next !== undefined) onRotate(next);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [active, intervalMs, maximizedPaneId, activeTabId, occupiedPanesInOrder, onRotate]);

  const toggle = useCallback(() => setActive((current) => !current), []);

  const cycleInterval = useCallback(() => {
    setIntervalMs((current) => {
      const index = ROTATION_INTERVALS_MS.indexOf(current);
      return ROTATION_INTERVALS_MS[(index + 1) % ROTATION_INTERVALS_MS.length] as RotationIntervalMs;
    });
  }, []);

  const notifyInput = useCallback(() => {
    setActive((current) => (current ? false : current));
  }, []);

  return { active, intervalMs, toggle, cycleInterval, notifyInput };
}
