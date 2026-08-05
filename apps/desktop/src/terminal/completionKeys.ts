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
// History-Navigation, Enter schickt ab, Tab ist die Tab-Completion der Shell —
// und ein einzelnes Escape ist in zsh der Meta-Präfix, der die NÄCHSTE Taste
// umdeutet (aus dem folgenden Enter wird `self-insert-unmeta`, das ein
// wörtliches CR in die Zeile schreibt, statt sie abzuschicken). Deshalb wird
// eine Taste nur dann genommen, wenn wirklich etwas sichtbar ist, das sie
// bedienen kann.

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
  suggestion: Pick<InlineSuggestion, "accept" | "directories">,
): boolean {
  const bare =
    !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
  const popup = suggestion.directories;

  if (bare && popup.visible()) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      popup.move(event.key === "ArrowDown" ? 1 : -1);
      return true;
    }
    if (event.key === "Escape") {
      popup.dismiss();
      return true;
    }
    if ((event.key === "Enter" || event.key === "Tab") && popup.accept()) {
      // Ohne das schöbe der Webview auf Tab zusätzlich den Fokus weiter und
      // trüge auf Enter einen Zeilenumbruch in xterms Hilfs-Textarea ein.
      event.preventDefault();
      return true;
    }
    // Jede andere Taste fällt weiter — die Liste beansprucht nur ihre fünf.
  }

  // Pfeil rechts (am Zeilenende) und Ctrl+F übernehmen den Geistertext — die
  // fish-Bindungen. Tab bleibt hier bewusst außen vor: PaneCrew hat, anders
  // als Warp, keinen eigenen Zeileneditor und könnte die echte Tab-Completion
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
