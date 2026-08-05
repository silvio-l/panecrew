# Tastaturkürzel

Diese Referenz wird aus `apps/desktop/src/shortcuts/registry.ts` erzeugt —
denselben Definitionen, die auch die Tastenerkennung zur Laufzeit treiben.
Regenerieren mit `node --experimental-strip-types scripts/generate-shortcuts-docs.ts`
aus `apps/desktop`, Ausgabe nach `docs/shortcuts.md` umleiten und committen.

## Gesamte Oberfläche

| Aktion | macOS | Windows / Linux |
| --- | --- | --- |
| Gesamte Oberfläche vergrößern | ⇧⌘+ | Ctrl+Shift++ |
| Gesamte Oberfläche verkleinern | ⇧⌘- | Ctrl+Shift+- |
| Oberflächen-Zoom zurücksetzen | ⇧⌘0 | Ctrl+Shift+0 |

## Aktive Terminal-Pane

| Aktion | macOS | Windows / Linux |
| --- | --- | --- |
| Schrift der aktiven Terminal-Pane vergrößern | ⌘+ | Ctrl++ |
| Schrift der aktiven Terminal-Pane verkleinern | ⌘- | Ctrl+- |
| Schriftgröße der aktiven Terminal-Pane zurücksetzen | ⌘0 | Ctrl+0 |

## Kontextabhängige Tasten im Terminal

Nicht in der Registry, weil sie nur gelten, solange die genannte Anzeige
sichtbar ist — sonst erreichen sie unverändert die Shell (Pfeiltasten bleiben
History-Navigation, Enter schickt ab, Tab bleibt die Tab-Completion der Shell).

| Taste | Wirkung, solange sichtbar |
| --- | --- |
| → (am Zeilenende), Ctrl+F | Sichtbare Inline-Ergänzung übernehmen |
| ↑ / ↓ | Auswahl im Verzeichnis-Popup bewegen |
| Enter, Tab | Ausgewähltes Verzeichnis übernehmen |
| Esc | Verzeichnis-Popup schließen |
