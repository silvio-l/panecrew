# PaneCrew

<p align="center">
  <img src="apps/desktop/src-tauri/icons/source/panecrew-icon-master-macos-padded.png" width="120" alt="PaneCrew" />
</p>

<p align="center">
  <a href="https://github.com/silvio-l/panecrew/actions/workflows/desktop-ci.yml"><img src="https://github.com/silvio-l/panecrew/actions/workflows/desktop-ci.yml/badge.svg" alt="Desktop CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/silvio-l/panecrew" alt="License"></a>
</p>

<p align="center">A grid of real, simultaneously visible terminal panes, not a tab-switcher.</p>

A single file explorer automatically follows whichever pane currently has focus.

Tool-agnostic by design: hosts any CLI coding agent — Claude Code, Codex, Gemini CLI, or a plain <!-- brandlint-ok: functional list of supported CLI tools, not orientation -->
shell — equally well. Runs on macOS and Windows.


## Features

- **Multi-Pane Grid:** up to four real, independently running terminal panes side by side, in one
  of several fixed layout templates
- **Focus-Following Explorer:** the file tree always shows whichever pane's project currently has
  focus — no manual switching
- **Real PTY, Not a Log Viewer:** every pane is a genuine `portable-pty` process, so any
  interactive CLI tool runs exactly as it would in a native terminal
- **Terminal Tabs:** multiple terminal sessions per pane, plus a file tab for viewing and editing
  without leaving the pane
- **Session Persistence:** projects, panes, and open files are restored automatically on restart
- **i18n:** runtime-switchable UI language (German/English so far), no restart required

## Status

Early, actively developed, not yet released. The core loop — multi-pane grid, real per-pane
terminals with tabs, a focus-following explorer with real filesystem read/write, and session
persistence — is built and in daily use developing PaneCrew itself. A code-executing extension
system and VS Code-theme import are decided in design but not yet implemented. <!-- brandlint-ok: functional reference to the actual planned theme-import format --> No packaged builds
exist yet; run from source (below).

## Getting Started

Requires [pnpm](https://pnpm.io/) and the [Tauri 2 prerequisites](https://tauri.app/start/prerequisites/)
for your platform (a Rust toolchain plus the platform's native webview dependencies).

```bash
git clone https://github.com/silvio-l/panecrew.git
cd panecrew/apps/desktop
pnpm install
pnpm tauri dev
```

`pnpm tauri build` produces a native, unsigned build for your platform. Signed/notarized releases
are planned but not yet published.

## Documentation

- [CLI reference](docs/cli.md) — command-line launch options
- [Keyboard shortcuts](docs/shortcuts.md)

## Contributing

This is currently a solo-maintained project without an established contribution process. Bug
reports and feature ideas are welcome via [Issues](https://github.com/silvio-l/panecrew/issues).

## Security

See [SECURITY.md](SECURITY.md) for how to report a vulnerability.

## License

Licensed under the [MIT license](LICENSE).

### Trademark

The PaneCrew name and logo are not covered by the license above. Forks and derivatives are welcome
but may not call themselves "PaneCrew" — "based on PaneCrew" is fine.
