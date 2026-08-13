// Cmd+←/→/Backspace unter macOS: die Konvention aus jedem Textfeld
// (Zeilenanfang/-ende, Löschen bis zum Zeilenanfang) — aber ein Terminal ist
// kein Textfeld, sondern hostet den Zeileneditor der Shell selbst (readline/
// zle). xterm.js kennt Cmd+←/→ nicht (schickt stillschweigend gar nichts)
// und behandelt Cmd+Backspace wie einfaches Backspace. Übersetzt wird
// deshalb hier, in Bytes, die readline/zle ohnehin verstehen: Ctrl+A/Ctrl+E/
// Ctrl+U.
//
// Eigenes Modul statt Teil des Tastatur-Handlers in usePtyTerminal.ts,
// gleiches Prinzip wie bei completionKeys.ts: eine reine Ja/Nein/Welche-
// Bytes-Entscheidung über ein Tastenereignis lässt sich prüfen, der Effekt
// drumherum kaum.

/** Nur das, was die Politik von einem Tastenereignis braucht. */
export interface LineEditingKey {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const CTRL_A = new Uint8Array([0x01]); // Zeilenanfang
const CTRL_E = new Uint8Array([0x05]); // Zeilenende
const CTRL_U = new Uint8Array([0x15]); // bis Zeilenanfang löschen

/**
 * `null`, wenn die Taste hier nicht gemeint ist — dann soll sie unangetastet
 * durchfallen (xterms Standardverhalten bzw. die Shell selbst).
 *
 * Nur die reine Cmd-Kombination ohne weitere Modifikatoren: Shift+Cmd+← hat
 * in einem Terminal kein sinnvolles Gegenstück (keine Textauswahl über
 * PTY-Bytes) und bleibt deshalb unangetastet, statt etwas zu erraten.
 */
export function macLineEditingBytes(event: LineEditingKey): Uint8Array | null {
  if (
    !event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.shiftKey
  ) {
    return null;
  }
  if (event.key === "ArrowLeft") return CTRL_A;
  if (event.key === "ArrowRight") return CTRL_E;
  if (event.key === "Backspace") return CTRL_U;
  return null;
}
