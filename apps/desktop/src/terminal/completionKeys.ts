import type { InlineSuggestion } from "./inlineSuggestion";

// Welche Taste der Vervollständigung gehört und welche der Shell.
//
// Eigenes Modul, weil genau hier ein gemeldeter Fehler saß und die Regel sonst
// nur im Tastatur-Handler einer React-Effekt-Funktion stünde, wo sie nicht
// prüfbar ist. Die Politik selbst ist eine reine Ja/Nein-Entscheidung über ein
// Tastenereignis — die kann man testen, den Effekt drumherum kaum.
//
// Der Grundsatz, und der Grund, warum das so eng gefasst ist: eine Taste, die
// hier durchfällt, macht in der Shell etwas Echtes. Pfeiltasten sind
// History-Navigation, Tab ist die Tab-Completion der Shell — und ein einzelnes
// Escape ist in zsh der Meta-Präfix, der die NÄCHSTE Taste umdeutet (aus dem
// folgenden Enter wird `self-insert-unmeta`, das ein wörtliches CR in die
// Zeile schreibt, statt sie abzuschicken). Deshalb wird eine Taste nur dann
// genommen, wenn wirklich etwas sichtbar ist, das sie bedienen kann.
//
// Enter ist von DIESER Politik (dem Verzeichnis-Popup) ganz ausgenommen und
// schickt immer ab (Produktentscheidung 2026-08-05). Ein Terminal-Nutzer hat
// jahrzehntelange Übung darin, dass Enter absendet; jede Ausnahme davon ist
// ein Stolperstein — der erste gemeldete Fehler dieses Features war genau
// einer: Der Nutzer drückte Escape nur deshalb, um sein Enter durchzubekommen,
// und ein Escape, das an der Liste vorbeigeht, macht in der Shell Schaden.
// Übernommen wird mit Tab, passend zur Tab-Completion, die die Shell an
// derselben Stelle ohnehin anbietet.
//
// Das `://`-Popup (snippetPopup.ts) unten ist die EINE bewusste Ausnahme von
// dieser Regel: `://foo` ist nie ein Befehl, den Enter absenden würde, die
// 2026-08-05-Begründung trägt hier also nicht — Enter übernimmt dort
// tatsächlich (Spec-Vorgabe). Genauso eng gefasst wie beim Verzeichnis-Popup:
// nur `if (bare && snippets.visible())`, sonst würde ein Enter, das wirklich
// die Shell meint, spurlos verschwinden.

/** Nur das, was die Politik von einem Tastenereignis braucht. */
export interface CompletionKey {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  preventDefault: () => void;
}

/** true = die Vervollständigung hat die Taste verbraucht. */
export function routeCompletionKey(
  event: CompletionKey,
  suggestion: Pick<InlineSuggestion, "accept" | "directories" | "snippets">,
): boolean {
  const bare =
    !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
  const popup = suggestion.directories;
  const snippets = suggestion.snippets;

  if (bare && snippets.visible()) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      snippets.move(event.key === "ArrowDown" ? 1 : -1);
      return true;
    }
    if (event.key === "Escape") {
      snippets.dismiss();
      return true;
    }
    if (event.key === "Enter") {
      snippets.accept();
      return true;
    }
    // Jede andere Taste fällt weiter.
  }

  if (bare && popup.visible()) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      popup.move(event.key === "ArrowDown" ? 1 : -1);
      return true;
    }
    if (event.key === "Escape") {
      popup.dismiss();
      return true;
    }
    if (event.key === "Tab" && popup.accept()) {
      // Ohne das schöbe der Webview auf Tab zusätzlich den Fokus weiter.
      event.preventDefault();
      return true;
    }
    // Jede andere Taste fällt weiter — die Liste beansprucht nur ihre vier.
  }

  // Pfeil rechts (am Zeilenende) und Ctrl+F übernehmen den Geistertext — die
  // fish-Bindungen. Tab bleibt hier bewusst außen vor: PaneCrew hat, anders
  // als Terminals mit eigenem Zeileneditor, keinen solchen und könnte die echte Tab-Completion
  // der Shell nicht ersetzen, sondern nur verdrängen.
  if (bare && event.key === "ArrowRight") return suggestion.accept();
  if (
    event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === "f"
  ) {
    return suggestion.accept();
  }

  return false;
}
