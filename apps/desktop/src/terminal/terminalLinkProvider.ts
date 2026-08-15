// Ausgelagert aus usePtyTerminal.ts — verdrahtet die reine Erkennung aus
// terminalLinkDetect.ts als eigenes xterm-ILinkProvider. Kein
// @xterm/addon-web-links: dessen WebLinksAddon liefert nur EINEN Handler für
// EINEN Regex und keine Kontrolle über `ILink.decorations` pro Treffer — für
// die geforderte "Unterstreichung nur solange der Modifier gehalten wird"
// (Ticket 01/02, .scratch/terminal-links-and-reveal/) reicht das nicht.
// `ILink.decorations` ist laut xterm-Typdefinition "tracked" — eine
// nachträgliche Mutation auf demselben Objekt löst ein Neuzeichnen aus, genau
// darauf setzt `applyDecorations()` unten.

import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import type {
  IBufferLine,
  ILink,
  ILinkDecorations,
  Terminal,
} from "@xterm/xterm";
import { isMacPlatform } from "../shortcuts/platform";
import { detectTerminalLinks, type TerminalLink } from "./terminalLinkDetect";

export interface TerminalLinkProviderHandle {
  dispose(): void;
}

export function attachTerminalLinkProvider(
  terminal: Terminal,
): TerminalLinkProviderHandle {
  let modifierHeld = false;
  // Nur die zuletzt an xterm gelieferte Zeile — mehr braucht es nicht: xterm
  // ruft provideLinks() pro gehoverter Zeile auf, "live" muss beim
  // Modifier-Wechsel nur die gerade gehoverte Spanne nachziehen.
  let liveLinks: ILink[] = [];

  const isActivationModifierHeld = (event: MouseEvent | KeyboardEvent) =>
    isMacPlatform() ? event.metaKey : event.ctrlKey;

  const applyDecorations = () => {
    const decorations = linkDecorations(modifierHeld);
    for (const link of liveLinks) link.decorations = decorations;
  };

  // keydown UND keyup: das Loslassen des Modifiers selbst liefert im
  // KeyboardEvent bereits metaKey/ctrlKey=false, isActivationModifierHeld
  // greift also für beide Richtungen unverändert.
  const handleModifierChange = (event: KeyboardEvent) => {
    const held = isActivationModifierHeld(event);
    if (held === modifierHeld) return;
    modifierHeld = held;
    applyDecorations();
  };
  window.addEventListener("keydown", handleModifierChange);
  window.addEventListener("keyup", handleModifierChange);

  const linkProviderDisposable = terminal.registerLinkProvider({
    provideLinks(bufferLineNumber, callback) {
      const bufferLine = terminal.buffer.active.getLine(bufferLineNumber - 1);
      if (!bufferLine) {
        callback(undefined);
        return;
      }
      const detected = detectTerminalLinks(bufferLine.translateToString(true));
      if (detected.length === 0) {
        callback(undefined);
        return;
      }
      liveLinks = detected.map((link) =>
        toLink(
          bufferLine,
          bufferLineNumber,
          link,
          () => modifierHeld,
          isActivationModifierHeld,
        ),
      );
      callback(liveLinks);
    },
  });

  return {
    dispose() {
      window.removeEventListener("keydown", handleModifierChange);
      window.removeEventListener("keyup", handleModifierChange);
      linkProviderDisposable.dispose();
    },
  };
}

function linkDecorations(held: boolean): ILinkDecorations {
  return { pointerCursor: held, underline: held };
}

function toLink(
  bufferLine: IBufferLine,
  y: number,
  link: TerminalLink,
  isModifierHeld: () => boolean,
  isActivationModifierHeld: (event: MouseEvent) => boolean,
): ILink {
  const startColumn = offsetToColumn(bufferLine, link.start) + 1;
  const endColumn = offsetToColumn(bufferLine, link.end);
  return {
    text: link.text,
    range: { start: { x: startColumn, y }, end: { x: endColumn, y } },
    decorations: linkDecorations(isModifierHeld()),
    activate(event) {
      if (!isActivationModifierHeld(event)) return;
      void openTerminalLink(link);
    },
  };
}

async function openTerminalLink(link: TerminalLink): Promise<void> {
  try {
    if (link.type === "url") {
      await openUrl(link.text);
      return;
    }
    // openPath öffnet eine Datei mit der OS-Standardanwendung UND einen
    // Ordner direkt in Finder/Explorer — dieselbe Weiche, die das OS trifft,
    // dieselbe Verwendung wie FileEditor.tsx' "Extern öffnen".
    await openPath(link.text);
  } catch (error) {
    console.error(
      "PaneCrew: Link/Pfad konnte nicht extern geöffnet werden",
      error,
    );
  }
}

// Bildet einen String-Offset innerhalb der von translateToString() erzeugten
// Zeile auf die zugehörige 0-basierte Buffer-Spalte ab — zellenweise, damit
// breite (z. B. CJK-)Zeichen VOR dem Link die nachfolgenden Spalten nicht
// verschieben. Absichtlich naiv gehalten (kein Zeilen-Wrap-Zusammenführen wie
// bei addon-web-links' LinkComputer): Links/Pfade, die exakt an einer
// Terminalbreiten-Grenze umbrechen, bleiben in v1 unklickbar — ein
// akzeptierter Randfall, kein Korrektheitsproblem für den Normalfall.
function offsetToColumn(bufferLine: IBufferLine, offset: number): number {
  let column = 0;
  let consumed = 0;
  while (consumed < offset) {
    const cell = bufferLine.getCell(column);
    if (!cell) break;
    if (cell.getWidth() === 0) {
      // Fortsetzungszelle eines breiten Zeichens — trägt zum String nichts
      // bei, translateToString() überspringt sie ebenso.
      column++;
      continue;
    }
    consumed += cell.getChars().length || 1;
    column++;
  }
  return column;
}
