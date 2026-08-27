# PaneCrew

A grid of live terminal panes across a multi-root VS Code workspace, paired
with a file explorer that automatically follows whichever pane currently has
focus.

<!-- TODO: screenshot -->

## What it does

PaneCrew turns VS Code into a grid of simultaneously visible terminal panes —
one per project — instead of a tab-switcher. Each pane is anchored to a
workspace folder in a multi-root workspace, arranged via VS Code's own
editor-group layout. A dedicated PaneCrew explorer in the activity bar shows
exactly one project's file tree at a time — whichever project owns the
terminal or editor tab you're currently focused on, switching automatically
as your focus moves — PaneCrew's signature feature, and (per this project's
own research) a gap even VS Code's built-in Explorer doesn't close on its
own.

Tool-agnostic by design: PaneCrew hosts any CLI tool in its terminals — shells,
Claude Code, Codex, Gemini CLI, or anything else — it makes no assumptions <!-- brandlint-ok: functional list of supported CLI tools -->
about what's running inside a pane.

## Install

**From the Marketplace**: search for "PaneCrew" in the
Extensions view, or run:

```
ext install silvio-lindstedt.panecrew
```

**From a `.vsix` file**:

```
code --install-extension panecrew-0.1.0.vsix
```

Or via the Extensions view: `···` menu → "Install from VSIX…".

## Features

- **Terminal grid**: `PaneCrew: Open Project Grid…` and `PaneCrew: Add Folder
  to Grid…` add a workspace folder and give it its own terminal, arranged
  automatically via VS Code's editor-group layout (single, split, 2×2 quad,
  three- and four-across rows, and 2-over-1/1-over-2 layouts).
- **Focus-following explorer**: switch terminals or editor tabs and the
  PaneCrew explorer (activity bar → PaneCrew icon) reveals the owning
  project automatically.
- **Git status decorations**: modified/added/untracked/deleted files and
  folders are badged and colored in the explorer, based on `git status`
  per workspace-folder root.
- **Search in folder**: right-click a folder in the PaneCrew explorer →
  "PaneCrew: Search in Folder…" to open VS Code's native Find in Files
  scoped to that folder.
- **Session persistence**: reopening a workspace restores its last grid
  layout and pane-to-folder assignments automatically.
- **Grid presets**: `PaneCrew: Save Current Grid as Preset…` /
  `PaneCrew: Load Grid Preset…` — named layouts, reusable across workspaces.
- **Two color themes**: "PaneCrew Dark" and "PaneCrew Light", offered once on
  first activation (opt-in, never applied silently) and available anytime via
  `PaneCrew: Set PaneCrew Theme…`.
- **Terminal links**: URLs and absolute file paths printed in a terminal
  become clickable.
- **Snippets**: store reusable command snippets per-workspace
  (`.vscode/panecrew-snippets.json`) or globally, and insert one into the
  active terminal via `PaneCrew: Insert Snippet…` (command palette).
- **Compact Look**: `PaneCrew: Apply Compact Look` hides secondary chrome
  (status bar, minimap by default) to make room for more panes. The activity
  bar always stays visible — Compact Look never hides it. Restore the
  previous look with `PaneCrew: Restore Default VS Code Look`.
- **Onboarding walkthrough**: "Get started with PaneCrew" in the Welcome
  view walks through opening a grid, touring the explorer, applying the
  theme, and Compact Look.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `panecrew.grid.defaultColumns` | `2` | Default column count for a new project grid. |
| `panecrew.grid.defaultRows` | `2` | Default row count for a new project grid. |
| `panecrew.compactLook.hideStatusBar` | `true` | Whether Compact Look hides the status bar. |
| `panecrew.compactLook.hideMinimap` | `true` | Whether Compact Look hides the editor minimap. |
| `panecrew.git.showDecorations` | `true` | Show git status badges/colors in the PaneCrew explorer. |
| `panecrew.snippets.defaultScope` | `workspace` | Where newly saved snippets are stored by default (`workspace` or `global`). |

Compact Look never hides the activity bar, regardless of settings — that row
stays visible in PaneCrew's standard look by design.

## Known limitations

A few features from the earlier Tauri desktop app have no equivalent in the
VS Code extension model and are intentionally not implemented:

- **Resource-usage / process-suspend guard**: the desktop app tracked and
  could suspend each pane's OS process tree directly. A VS Code extension
  does not own the terminal's process tree the way a native app hosting its
  own PTYs did, so this isn't implementable here.
- **Cross-window OS-level pane drag**: dragging a pane out into its own OS
  window has no VS Code extension API. VS Code's own native tab drag between
  windows is the closest equivalent when terminals are hosted as editor tabs.
- **Custom auto-updater**: replaced entirely by the VS Code Marketplace's own
  auto-update mechanism.
- **Live in-terminal snippet popup**: the desktop app's `://` trigger opened
  an overlay directly inside the terminal's own screen buffer. An extension
  cannot render into a terminal's live content, so snippet insertion here is
  a command-palette quick pick (`PaneCrew: Insert Snippet…`) instead — an
  intentional UI adaptation, not a silent regression.

## Development

```
pnpm install
pnpm --filter panecrew --dir apps/extension run compile
```

- `pnpm --filter panecrew --dir apps/extension run watch` — incremental build.
- `pnpm --filter panecrew --dir apps/extension run test:unit` — vitest unit
  tests for every pure-logic module (grid state, terminal link detection,
  snippet matching, onboarding state, session state, git status parsing, the
  grid→layout translation).
- `pnpm --filter panecrew --dir apps/extension run test:integration` — a
  `@vscode/test-electron` smoke test that activates the extension inside a
  real VS Code host and asserts commands/views are registered.
  <!-- brandlint-ok: literal npm package name of a direct devDependency -->
- Press F5 in VS Code (with `apps/extension` open) to launch an Extension
  Development Host.

## License

MIT — see [LICENSE](./LICENSE).
