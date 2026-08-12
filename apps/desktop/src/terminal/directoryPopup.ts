import type { IDecoration, IMarker, Terminal } from "@xterm/xterm";
import i18next from "../i18n";
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

/** Wie hoch die Liste höchstens wird, in Zellzeilen — Fußzeile eingerechnet. */
const MAX_ROWS = 8;

/** Was die Tastatur mit dem Popup machen darf. */
export interface DirectoryPopupControls {
  visible: () => boolean;
  /** Auswahl bewegen; wirkt erst beim nächsten Rendern. */
  move: (delta: number) => void;
  /** Übernimmt den ausgewählten Eintrag; false, wenn keiner sichtbar ist. */
  accept: () => boolean;
  /** Wegblenden bis zum nächsten Tastendruck — die Eingabezeile bleibt. */
  dismiss: () => void;
}

export interface DirectoryPopup extends DirectoryPopupControls {
  /** Neu bewerten; wird aus dem Render-Durchgang der Vervollständigung gerufen. */
  update: (state: CdCompletionInput) => void;
  /** Der Nutzer hat getippt — ein `dismiss` gilt damit nicht weiter. */
  resume: () => void;
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
  /**
   * Hat der Nutzer die Liste eben weggedrückt?
   *
   * Gebunden an „bis zum nächsten Tastendruck", nicht an den Eingabetext: Was
   * die Zeile gerade enthält, ändert sich auch ohne Zutun des Nutzers — die
   * Shell spiegelt eine übernommene Ergänzung erst Millisekunden später
   * zurück. An den Text gebunden wäre ein Escape unmittelbar nach einer
   * Übernahme durch genau dieses Echo wieder aufgehoben, und die Liste stünde
   * erneut da, obwohl der Nutzer gerade gesagt hat, dass er sie nicht will.
   */
  let dismissed = false;
  /**
   * Steht die Liste noch, gehört aber schon zu einer überholten Eingabe?
   *
   * Der Zustand direkt nach einer Übernahme: geschrieben ist sie, die Shell
   * hat sie aber noch nicht zurückgespiegelt. Sichtbar bleibt die Liste dabei
   * — sonst gäbe es genau hier wieder eine Lücke, in der ein Escape an ihr
   * vorbei in die Shell fiele. Nur übernehmen lässt sie sich nicht: ein
   * schnelles zweites Tab würde sonst denselben Eintrag ein zweites Mal
   * einfügen, statt die Vervollständigung der Shell auszulösen.
   */
  let stale = false;
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
    stale = false;
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
    // Welche Taste übernimmt, sieht man einer Liste nicht an — und hier ist es
    // nicht die, die man erwartet: Enter schickt im Terminal immer ab, auch
    // mit offener Liste. Ohne diesen Hinweis probiert man Enter, bekommt
    // seinen Befehl ausgeführt und hält die Liste für kaputt. Beide Tasten
    // stehen deshalb da, nicht nur die richtige.
    const footer = document.createElement("div");
    footer.className = "pc-cdpopup__footer";
    for (const [cap, action] of [
      ["Tab", i18next.t("directoryPopup.tabHint")],
      ["Enter", i18next.t("directoryPopup.enterHint")],
    ]) {
      const hint = document.createElement("span");
      hint.className = "pc-cdpopup__hint";
      const key = document.createElement("kbd");
      key.textContent = cap ?? "";
      hint.append(key, action ?? "");
      footer.append(hint);
    }
    if (hidden > 0) {
      const more = document.createElement("span");
      more.className = "pc-cdpopup__count";
      // Ohne diesen Hinweis läse sich eine abgeschnittene Liste wie eine
      // vollständige — und der gesuchte Ordner wäre scheinbar nicht da.
      // Gezählt wird, was das Backend geliefert hat; das ist dort selbst schon
      // gedeckelt, bei sehr vielen Treffern fehlen also mehr, als hier steht.
      more.textContent = `+${hidden}`;
      footer.append(more);
    }
    list.append(footer);
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
    // Eine Zeile gehört immer der Fußzeile (Tastenhinweis, bei Bedarf mit
    // „+N"). Bleibt dafür kein Platz, steht sie trotzdem da — der Hinweis ist
    // wichtiger als die Zeile Einträge, die sie kostet.
    const shown = Math.min(entries.length, Math.max(1, capacity - 1));
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
      if (!completion || dismissed) {
        hide();
        return;
      }

      const nextKey = `${completion.cwd}\x00${completion.directory}\x00${completion.prefix}`;
      if (nextKey !== key) {
        key = nextKey;
        selected = 0;
        windowStart = 0;
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
        stale = false;
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
      const name = stale ? undefined : entries[selected];
      if (!name) return false;
      // Über denselben Schreibpfad wie eine echte Eingabe: die Shell spiegelt
      // den Text zurück, und der nächste Render-Durchgang bietet direkt die
      // nächste Ebene an.
      write(completionInsert(prefix, name, quoted));
      // Stehen bleiben statt verschwinden — Begründung bei `stale`.
      stale = true;
      return true;
    },

    dismiss: () => {
      dismissed = true;
      hide();
    },

    resume: () => {
      dismissed = false;
    },

    clear: () => {
      dismissed = false;
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
