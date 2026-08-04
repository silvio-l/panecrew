# PaneCrew

A cross-platform desktop app (macOS + Windows) for running multiple real, simultaneously visible
terminal sessions across different projects at once — a grid of live panes, not a tab-switcher —
paired with a single file explorer that automatically follows whichever pane currently has focus.

Tool-agnostic by design: hosts any CLI coding agent (Claude Code, Codex, Gemini CLI, plain shells)
equally well.

## Status

Early scaffold. The Tauri 2 + React/TypeScript app builds and runs (`apps/desktop`), with a
placeholder UI shell and the app icon in place. Core features (real PTY-backed terminal panes,
focus-following explorer, session persistence) are not implemented yet.

## License

Licensed under the [MIT license](LICENSE).

## Trademark

The PaneCrew name and logo are not covered by the license above. Forks and derivatives are welcome
but may not call themselves "PaneCrew" — "based on PaneCrew" is fine.
