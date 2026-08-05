import type { IDecoration, IMarker, Terminal } from "@xterm/xterm";
import type { CdCompletionInput } from "./suggestion";
import { cdCompletion, completionInsert } from "./suggestion";
import type { SubdirectoryLookup } from "./workingDirectory";

// Das Verzeichnis-Popup einer `cd`-Zeile: die echten Unterverzeichnisse des
// Arbeitsverzeichnisses, gefiltert nach dem bereits Getippten.
//
// Der Unterschied zum Geistertext nebenan ist nicht die Optik, sondern die
// Quelle: der rät aus der History und lässt sich das Geratene bestätigen, das
// hier liest, was wirklich da liegt. Beide dürfen gleichzeitig sichtbar sein —
// so wie fish eine Inline-Ergänzung UND eine Vervollständigungsliste zeigt.
//
// Angehängt wird die Liste an denselben Mechanismus wie der Geistertext
// (Marker + Decoration), damit sie ohne eigene Pixelrechnung an der richtigen
// Zelle hängt. Sie wird ausschließlich mit der Tastatur bedient und ist
// deshalb `pointer-events: none`: ein Mausklick darin würde in xterms eigener
// Textselektion landen, und eine Zeile, die auf Hover reagiert, aber auf einen
// Klick nicht, verspricht mehr, als sie hält.

/** Wie viele Einträge höchstens gleichzeitig sichtbar sind. */
const MAX_ROWS = 8;

/** Was die Tastatur mit dem Popup machen darf. */
export interface DirectoryPopupControls {
  visible: () => boolean;
  /** Auswahl bewegen; wirkt erst beim nächsten Rendern. */
  move: (delta: number) => void;
  /** Übernimmt den ausgewählten Eintrag; false, wenn keiner sichtbar ist. */
  accept: () => boolean;
  /** Wegblenden, bis sich die Eingabe ändert — die Eingabezeile bleibt. */
  dismiss: () => void;
}

export interface DirectoryPopup extends DirectoryPopupControls {
  /** Neu bewerten; wird aus dem Render-Durchgang der Vervollständigung gerufen. */
  update: (state: CdCompletionInput) => void;
  /** Alles vergessen, auch ein `dismiss` — für abgeschickte/verworfene Zeilen. */
  clear: () => void;
  dispose: () => void;
}

export function attachDirectoryPopup(
  terminal: Terminal,
  {
    write,
    listSubdirectories,
    font,
  }: {
    /** Schreibt Text in die PTY (derselbe Pfad wie eine echte Eingabe). */
    write: (text: string) => void;
    listSubdirectories: SubdirectoryLookup;
    font: { fontFamily: string; fontSize: number };
  },
): DirectoryPopup {
  let entries: readonly string[] = [];
  let prefix = "";
  let quoted = false;
  /** Identität der aktuellen Anfrage: cwd + Verzeichnis + Präfix. */
  let key = "";
  let dismissedKey: string | null = null;
  let selected = 0;
  let windowStart = 0;

  let marker: IMarker | null = null;
  let decoration: IDecoration | null = null;
  /** Der gebaute Listen-Knoten und die Signatur, aus der er entstand. */
  let node: HTMLElement | null = null;
  let nodeSignature = "";

  const detach = () => {
    decoration?.dispose();
    marker?.dispose();
    decoration = null;
    marker = null;
  };

  const hide = () => {
    entries = [];
    detach();
  };

  const buildNode = (shown: number, hidden: number): HTMLElement => {
    const list = document.createElement("div");
    list.className = "pc-cdpopup";
    // Die Zellentypografie steht nicht im Decoration-Container; ohne diese
    // Angaben säße die Liste in der UI-Schrift des Chromes statt in der
    // Terminalschrift, in der die Pfade darüber stehen.
    list.style.fontFamily = font.fontFamily;
    list.style.fontSize = `${font.fontSize}px`;

    for (let index = windowStart; index < windowStart + shown; index += 1) {
      const item = document.createElement("div");
      item.className =
        index === selected
          ? "pc-cdpopup__item pc-cdpopup__item--selected"
          : "pc-cdpopup__item";
      item.textContent = entries[index] ?? "";
      list.append(item);
    }
    if (hidden > 0) {
      const more = document.createElement("div");
      more.className = "pc-cdpopup__more";
      // Ohne diesen Hinweis läse sich eine abgeschnittene Liste wie eine
      // vollständige — und der gesuchte Ordner wäre scheinbar nicht da.
      // Gezählt wird, was das Backend geliefert hat; das ist dort selbst schon
      // gedeckelt, bei sehr vielen Treffern fehlen also mehr, als hier steht.
      more.textContent = `+${hidden}`;
      list.append(more);
    }
    return list;
  };

  const draw = (column: number) => {
    const buffer = terminal.buffer.active;
    // Platz nach unten und oben, in Zeilen. Passt die Liste unten nicht, wird
    // sie nach oben geklappt: so bleibt sie in der Terminalfläche, statt am
    // unteren Rand der Pane abgeschnitten zu werden.
    const below = terminal.rows - buffer.cursorY - 1;
    const above = buffer.cursorY;
    const downwards = below >= Math.min(entries.length, MAX_ROWS) || below >= above;
    const capacity = Math.max(1, Math.min(MAX_ROWS, downwards ? below : above));
    // Passt nicht alles, geht eine Zeile an den „+N"-Hinweis.
    const shown =
      entries.length > capacity && capacity > 1 ? capacity - 1 : Math.min(entries.length, capacity);
    const hidden = entries.length - shown;

    // Die Auswahl bleibt im sichtbaren Ausschnitt.
    if (selected < windowStart) windowStart = selected;
    if (selected >= windowStart + shown) windowStart = selected - shown + 1;
    windowStart = Math.max(0, Math.min(windowStart, entries.length - shown));

    const signature = `${entries.join("\n")}\x00${selected}\x00${windowStart}\x00${shown}\x00${hidden}`;
    // onRender feuert mehrfach; ein jedes Mal neu gebauter Knoten würde die
    // Liste bei jedem Frame flackern lassen.
    if (!node || signature !== nodeSignature) {
      node = buildNode(shown, hidden);
      nodeSignature = signature;
    }
    const list = node;

    detach();
    const nextMarker = terminal.registerMarker(0);
    const nextDecoration = terminal.registerDecoration({
      marker: nextMarker,
      x: column,
      width: 1,
      layer: "top",
    });
    if (!nextDecoration) {
      nextMarker.dispose();
      return;
    }
    marker = nextMarker;
    decoration = nextDecoration;
    nextDecoration.onRender((element) => {
      element.style.overflow = "visible";
      element.style.pointerEvents = "none";
      // Die Decoration ist genau eine Zelle groß; die Liste hängt sich von
      // dort aus unter (bzw. über) die Eingabezeile.
      list.style.top = downwards ? "100%" : "auto";
      list.style.bottom = downwards ? "auto" : "100%";
      if (element.firstChild !== list) element.replaceChildren(list);
    });
  };

  return {
    update: (state) => {
      const completion = cdCompletion(state);
      if (!completion) {
        hide();
        return;
      }

      const nextKey = `${completion.cwd}\x00${completion.directory}\x00${completion.prefix}`;
      if (nextKey !== key) {
        key = nextKey;
        selected = 0;
        windowStart = 0;
        // Verworfen ist eine Anzeige zu genau dieser Eingabe. Sobald sich die
        // Eingabe ändert, gilt das nicht mehr — sonst bliebe die Liste auch
        // dann weg, wenn der Nutzer über ein Backspace wieder auf dieselbe
        // Stelle zurückkommt, und das Verstecken hinge an einem Zustand, den
        // er längst vergessen hat.
        dismissedKey = null;
      }
      if (nextKey === dismissedKey) {
        hide();
        return;
      }

      // Immer der AKTUELLE Stand der Eingabe, auch wenn die Liste darunter
      // noch die vorige ist: `completionInsert` rechnet den Unterschied aus
      // und nimmt per Backspace zurück, was nicht passt.
      prefix = completion.prefix;
      quoted = completion.quoted;

      const names = listSubdirectories(
        completion.cwd,
        completion.directory,
        completion.prefix,
      );
      if (names) {
        // Leer heißt „nichts, das passt" — ein leerer Rahmen wäre nur Chrome
        // ohne Inhalt.
        if (names.length === 0) {
          hide();
          return;
        }
        entries = names;
      } else if (entries.length === 0) {
        // Die erste Abfrage läuft noch; es gibt nichts zu halten.
        return;
      }
      // Sonst: Abfrage läuft, aber es steht schon eine Liste da — die bleibt.
      // Sie eine Antwortzeit lang wegzunehmen hieße, sie bei JEDEM Zeichen
      // aus- und wieder einzublenden; und ein Escape in dieser Lücke ginge an
      // der Liste vorbei in die Shell, wo es als Meta-Präfix die nächste
      // Taste verschluckt.

      // Linksbündig zum angefangenen Segment, nicht zum Cursor: die Einträge
      // stehen damit unter dem Wort, das sie fortsetzen.
      draw(Math.max(0, state.cursor.x - completion.prefix.length));
    },

    visible: () => entries.length > 0,

    move: (delta) => {
      if (entries.length === 0) return;
      selected = Math.max(0, Math.min(entries.length - 1, selected + delta));
    },

    accept: () => {
      const name = entries[selected];
      if (!name) return false;
      // Über denselben Schreibpfad wie eine echte Eingabe: die Shell spiegelt
      // den Text zurück, und der nächste Render-Durchgang bietet direkt die
      // nächste Ebene an.
      write(completionInsert(prefix, name, quoted));
      hide();
      return true;
    },

    dismiss: () => {
      dismissedKey = key;
      hide();
    },

    clear: () => {
      dismissedKey = null;
      key = "";
      selected = 0;
      windowStart = 0;
      hide();
    },

    dispose: () => {
      detach();
      node = null;
    },
  };
}
