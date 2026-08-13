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
| Neues PaneCrew-Fenster öffnen | ⌘N | Ctrl+N |

## Aktive Pane

Nicht mehr nur „Terminal-Pane": eine Pane zeigt seit dem Mini-Editor entweder
ihr Terminal oder eine geöffnete Datei, und beide Zustände bringen eigene
Kürzel mit. Es gilt jeweils das der Fläche, die gerade den Tastaturfokus hat.

| Aktion | macOS | Windows / Linux |
| --- | --- | --- |
| Schrift der aktiven Terminal-Pane vergrößern | ⌘+ | Ctrl++ |
| Schrift der aktiven Terminal-Pane verkleinern | ⌘- | Ctrl+- |
| Schriftgröße der aktiven Terminal-Pane zurücksetzen | ⌘0 | Ctrl+0 |
| Geöffnete Datei speichern | ⌘S | Ctrl+S |
| Fokus-Modus umschalten (Pane maximieren/verlassen) | ⌘↵ | Ctrl+↵ |
| Terminal-Tab 1 der aktiven Pane anzeigen | ⌘1 | Ctrl+1 |
| Terminal-Tab 2 der aktiven Pane anzeigen | ⌘2 | Ctrl+2 |
| Terminal-Tab 3 der aktiven Pane anzeigen | ⌘3 | Ctrl+3 |
| Terminal-Tab 4 der aktiven Pane anzeigen | ⌘4 | Ctrl+4 |
| Terminal-Tab 5 der aktiven Pane anzeigen | ⌘5 | Ctrl+5 |
| Terminal-Tab 6 der aktiven Pane anzeigen | ⌘6 | Ctrl+6 |
| Terminal-Tab 7 der aktiven Pane anzeigen | ⌘7 | Ctrl+7 |
| Terminal-Tab 8 der aktiven Pane anzeigen | ⌘8 | Ctrl+8 |
| Terminal-Tab 9 der aktiven Pane anzeigen | ⌘9 | Ctrl+9 |

## Kontextabhängige Tasten im Terminal

Nicht in der Registry, weil sie nur gelten, solange die genannte Anzeige
sichtbar ist — sonst erreichen sie unverändert die Shell (Pfeiltasten bleiben
History-Navigation, Tab bleibt die Tab-Completion der Shell).

**Enter ist bewusst nicht dabei und schickt immer ab**, auch bei offener
Liste. Im Terminal hat die Taste genau eine Bedeutung, und die zu verbiegen
kostet mehr, als die Übernahme per Enter einbringt.

| Taste | Wirkung, solange sichtbar |
| --- | --- |
| → (am Zeilenende), Ctrl+F | Sichtbare Inline-Ergänzung übernehmen |
| ↑ / ↓ | Auswahl im Verzeichnis-Popup bewegen |
| Tab | Ausgewähltes Verzeichnis übernehmen |
| Esc | Verzeichnis-Popup schließen |
