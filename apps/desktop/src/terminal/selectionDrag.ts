// Ausgelagert aus usePtyTerminal.ts, damit es isoliert testbar ist — dieselbe
// Konvention wie resizeGate.ts/clipboard.ts.

/**
 * Trägt, ob eine Mausauswahl-Geste gerade in DIESEM Terminal begonnen hat.
 *
 * Der Kopier-Trigger für "Select to Copy" muss auf `mouseup` reagieren, egal
 * wo im Dokument der Zeiger beim Loslassen steht — ein Drag, der über den
 * oberen/unteren Rand der Pane hinausgezogen wird, feuert `mouseup` sonst
 * gar nicht (das Event geht an das Element, über dem sich der Zeiger beim
 * Loslassen befindet, nicht an das, auf dem der Drag begann). xterm.js hält
 * die Selektion in diesem Fall trotzdem korrekt fest (`hasSelection()`), nur
 * ein NUR-auf-dem-Container gebundener Listener verpasst das Ereignis.
 *
 * Ein dokumentweiter `mouseup`-Listener allein wäre aber zu grob: ohne diesen
 * Tracker würde JEDE Pane mit noch stehender alter Selektion bei jedem
 * beliebigen Klick irgendwo sonst in der App (ein Button in einer anderen
 * Pane, im Explorer, …) erneut kopieren. `onMouseDown` markiert den Beginn
 * EINES Drags in diesem Terminal, `onMouseUp` löst `onOwnDragEnd` nur aus,
 * wenn genau dieser Drag es war, der gerade endet — unabhängig davon, wo im
 * Dokument das Loslassen stattfand.
 */
export function createSelectionDragTracker(): {
  onMouseDown: () => void;
  onMouseUp: (onOwnDragEnd: () => void) => void;
} {
  let active = false;
  return {
    onMouseDown: () => {
      active = true;
    },
    onMouseUp: (onOwnDragEnd: () => void) => {
      if (!active) return;
      active = false;
      onOwnDragEnd();
    },
  };
}
