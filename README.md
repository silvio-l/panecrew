# PaneCrew

<p align="center">
  <img src="assets/brand/panecrew-icon-master-macos-padded.png" width="120" alt="PaneCrew" />
</p>

<p align="center">
  <a href="https://github.com/silvio-l/panecrew/actions/workflows/extension-ci.yml"><img src="https://github.com/silvio-l/panecrew/actions/workflows/extension-ci.yml/badge.svg" alt="Extension CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/silvio-l/panecrew" alt="License"></a>
</p>

<p align="center">A grid of real, simultaneously visible terminal panes, not a tab-switcher.</p>

PaneCrew is a VS Code extension. It turns a multi-root workspace into a grid of live terminal
panes — one per project — paired with a single file explorer that automatically follows whichever
pane currently has focus.

Tool-agnostic by design: hosts any CLI coding agent — Claude Code, Codex, Gemini CLI, or a plain
shell — equally well.

## Features

- **Terminal grid:** each workspace folder gets its own terminal, arranged via VS Code's own
  editor-group layout (single, split, 2×2 quad, three- and four-across rows, and mixed layouts).
- **Focus-following explorer:** the PaneCrew explorer (activity bar) always shows whichever
  project's terminal or editor tab currently has focus — no manual switching.
- **Git status decorations:** modified/added/untracked/deleted files and folders are badged and
  colored in the explorer, based on `git status` per workspace-folder root.
- **Session persistence:** reopening a workspace restores its last grid layout and pane-to-folder
  assignments automatically.
- **Grid presets, snippets, terminal links, two color themes, a Compact Look, and an onboarding
  walkthrough.** See [`apps/extension/README.md`](apps/extension/README.md) for the full feature
  and settings reference.

## Status

Actively developed. The core loop — terminal grid, focus-following explorer with git decorations,
snippets, themes, and session persistence — is built, tested, and in daily use developing PaneCrew
itself.

## Install

**From the Marketplace**: search for "PaneCrew" in the Extensions view, or run:

```
ext install silvio-lindstedt.panecrew
```

**From a `.vsix` file**:

```
code --install-extension panecrew-0.1.0.vsix
```

Or via the Extensions view: `···` menu → "Install from VSIX…".

Full install/feature/settings reference: [`apps/extension/README.md`](apps/extension/README.md).

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
