# Keyboard Shortcuts

This reference is generated from `apps/desktop/src/shortcuts/registry.ts` —
the same definitions that also drive key detection at runtime. Regenerate
with `node --experimental-strip-types scripts/generate-shortcuts-docs.ts`
from `apps/desktop`, redirect the output to `docs/shortcuts.md`, and commit it.

## Whole Interface

| Action | macOS | Windows / Linux |
| --- | --- | --- |
| Zoom in on the whole interface | ⇧⌘+ | Ctrl+Shift++ |
| Zoom out on the whole interface | ⇧⌘- | Ctrl+Shift+- |
| Reset interface zoom | ⇧⌘0 | Ctrl+Shift+0 |
| Open a new PaneCrew window | ⌘N | Ctrl+N |
| Search file contents in the focused pane's project | ⇧⌘F | Ctrl+Shift+F |
| Split the focused pane into a new empty pane | ⇧⌘5 | Ctrl+Shift+5 |

## Active Pane

No longer just "terminal pane": since the mini editor, a pane shows either
its terminal or an open file, and both states bring their own shortcuts.
Whichever surface currently has keyboard focus applies.

| Action | macOS | Windows / Linux |
| --- | --- | --- |
| Increase font size of the active terminal pane | ⌘+ | Ctrl++ |
| Decrease font size of the active terminal pane | ⌘- | Ctrl+- |
| Reset font size of the active terminal pane | ⌘0 | Ctrl+0 |
| Save the open file | ⌘S | Ctrl+S |
| Toggle focus mode (maximize/leave pane) | ⌘↵ | Ctrl+↵ |
| Close the active terminal tab | ⌘W | Ctrl+W |
| Open a new terminal tab in the active pane | ⇧⌘T | Ctrl+Shift+T |
| Clear the active terminal's scrollback | ⌘K | — |
| Show terminal tab 1 of the active pane | ⌘1 | Ctrl+1 |
| Show terminal tab 2 of the active pane | ⌘2 | Ctrl+2 |
| Show terminal tab 3 of the active pane | ⌘3 | Ctrl+3 |
| Show terminal tab 4 of the active pane | ⌘4 | Ctrl+4 |
| Show terminal tab 5 of the active pane | ⌘5 | Ctrl+5 |
| Show terminal tab 6 of the active pane | ⌘6 | Ctrl+6 |
| Show terminal tab 7 of the active pane | ⌘7 | Ctrl+7 |
| Show terminal tab 8 of the active pane | ⌘8 | Ctrl+8 |
| Show terminal tab 9 of the active pane | ⌘9 | Ctrl+9 |

## Context-Dependent Keys in the Terminal

Not in the registry, because they only apply while the named display is
visible — otherwise they reach the shell unchanged (arrow keys stay history
navigation, Tab stays the shell's own tab completion).

**Enter is deliberately not included and always submits**, even with a list
open. In the terminal the key has exactly one meaning, and bending that costs
more than accepting via Enter would gain.

| Key | Effect while visible |
| --- | --- |
| → (at end of line), Ctrl+F | Accept the visible inline completion |
| ↑ / ↓ | Move selection in the directory popup |
| Tab | Accept the selected directory |
| Esc | Close the directory popup |
