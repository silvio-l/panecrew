# AGENTS.md

- **Language (2026-08-16, global rule, repeated here since this repo's existing comments/commits predate it and are German — new ones are not):** commit messages and code comments always English; chat with the user always German; changelogs/docs of a multi-language tool primarily English. Do not mass-rewrite existing German comments/commits just to comply — only new content follows this.
- Dev loop: open `apps/extension` in VS Code and press F5 (`Run PaneCrew Extension` in `apps/extension/.vscode/launch.json`) to launch an Extension Development Host with the extension loaded — this is the primary way to run/debug it, not a terminal command.
- Compile/typecheck: `pnpm --filter panecrew --dir apps/extension run compile` (runs `check-types` then esbuild). `pnpm --filter panecrew --dir apps/extension run watch` for incremental builds.
- Test: `pnpm --filter panecrew --dir apps/extension run test:unit` (Vitest, pure-logic modules — grid state, terminal link detection, snippet matching, onboarding state, session state, git status parsing) and `pnpm --filter panecrew --dir apps/extension run test:integration` (`@vscode/test-electron` smoke test, activates the extension inside a real VS Code host). <!-- brandlint-ok: literal npm package name of a direct devDependency -->
- Package: `pnpm --filter panecrew --dir apps/extension run package` (typecheck + production esbuild + `vsce package`, produces the `.vsix`). Wired into `.github/workflows/extension-ci.yml` as a CI backstop against packaging regressions.
- Regenerate brand icon assets from the master art: `assets/brand/generate-icons.sh`. The vector source of truth is `assets/brand/panecrew-mark.svg` — edit the SVG, not the PNGs, and rerun the script. Dormant since the 2026-08-27 VS Code extension pivot (it still shells out to the deleted Tauri app's `pnpm tauri icon` step) — see the script's own header before relying on it; it needs a plain rsvg-convert/magick export step for extension/Marketplace/website icon sizes in place of that step.
- Parallel-agent worktrees: follow the global `agent-<slug>` convention (`~/.claude/infrastructure/multi-agent-worktrees.md`). Each worktree needs its own `pnpm install`; unlike the old Tauri app there's no shared dev-server port to worry about (`F5` launches an independent Extension Development Host per VS Code window). <!-- brandlint-ok: local filesystem path to the user's own tooling config, not a public reference -->

Planning is tracked as a **wayfinder map**: `.scratch/panecrew-v0.1-spec/map.md` (plus child tickets under `.scratch/panecrew-v0.1-spec/issues/`) — read it before making architectural/scope decisions, keeping in mind it predates the 2026-08-27 pivot from the Tauri desktop app to the VS Code extension (`apps/extension`) as PaneCrew's sole product; read it for historical rationale, not as a current build sequence. `docs/decisions.md` holds the earlier, broader planning record (rationale, rejected alternatives, full requirements) the map builds on, including the pivot decision itself; read both, decisions.md first.

## What PaneCrew is

A VS Code extension for running multiple real, simultaneously visible terminal sessions across different projects at once — a grid of live panes, not a tab-switcher — paired with a single file explorer that automatically follows whichever pane currently has focus. Tool-agnostic: must host any CLI coding agent (Claude Code, Codex, Gemini CLI, plain shells) equally well, not just Anthropic's tooling. <!-- brandlint-ok: functional list of supported CLI tools, defines the tool-agnosticism requirement itself -->

## Brand

- **Name/casing**: the name is `panecrew`. Display it as **PaneCrew** everywhere a human reads it (README, docs, in-app UI, the extension's Marketplace display name). Technical identifiers stay lowercase `panecrew` (domain, GitHub repo, `package.json` names, the VS Code extension ID, future CLI binary) — never rename those to match the display casing. Full rationale: `docs/decisions.md`, 2026-08-04 entries.
- **Icon direction**: "K3H — Verzahnung (Amber)" — a chevron (`>`) interlocked with a cursor block (`_`) via a diagonal miter, one fused emblem, not two characters side by side. Warm amber-gold on dark indigo. **Single vector source of truth**: `assets/brand/panecrew-mark.svg` (Fable-authored, gradient/geometry verified against the original AI-raster master, which it has since replaced; relocated here from the deleted `apps/desktop/src-tauri/icons/source/` on the 2026-08-27 pivot). Every derived icon — the extension's Marketplace/activity-bar icon, the website's favicon and brand assets — should trace back to this one file, so there is no drift between surfaces. The seam gap between chevron and cursor block is deliberately wider than the original master's own (too-tight) proportions — a small departure from strict pixel-parity made specifically for legibility at real small sizes. Full derivation across four refinement rounds: `docs/decisions.md`.
- **Geometry carries the brand; color is now split by surface.** The interlocked chevron+cursor form is the recognizable mark everywhere. Color: the app icon, favicon, and the extension's own brand-mark surfaces render the real amber/gold gradient from `panecrew-mark.svg`. Elsewhere — general UI accent, focus rings, selection states — that's now VS Code's own theming (via the PaneCrew Dark/Light color themes the extension ships), not a custom chrome the way the Tauri app's `--pc-focusBorder` token was; the same principle carries over: exactly one accent, reserved for focus, never colliding with live ANSI terminal semantics (red=error, yellow=warning, green=success) rendered as real content inside the panes. **Light theme**: the master gradient is tuned against the icon's dark indigo ground and loses contrast on light surfaces — an independently OKLCH-derived light variant (same hue family, lightness re-derived on the light ground) exists for exactly this reason; see `docs/decisions.md` → "Amber-Marke auf Light-Theme" for the derivation and numbers, which still applies wherever the mark needs to render on a light surface (e.g. the website). Any further brand-consistency work must go through existing VS Code theme tokens or the PaneCrew themes' own token files, not new hardcoded colors — except the mark's own gradients, which are fixed brand identity, not a themeable token.

## Architecture

- **VS Code extension** (`apps/extension`), TypeScript, esbuild-bundled — not a standalone native app with its own bundled runtime
- **VS Code's own APIs** for everything the Tauri app used to build itself: `vscode.window.createTerminal` + editor-group layout commands for the terminal grid, `TreeDataProvider` for the focus-following explorer, `vscode.workspace` for git-status decorations, the color-theme API for PaneCrew's themes
- Tool-agnostic: the terminal-hosting layer must never encode assumptions about which CLI agent runs inside it (no Claude-Code-specific parsing) <!-- brandlint-ok: defines the tool-agnosticism requirement itself, names what NOT to build -->

The explorer-follows-focused-pane behavior is the product's core differentiator (confirmed via research to be an unaddressed gap even in VS Code itself — see decisions.md) — treat it as first-class, not a bolt-on.

## Reference repositories

Read-only clones kept **outside** this repo, so they never enter its git index, licence surface, or `.ossallowlist`:

- **VS Code** — `~/Documents/Projekte/reference-repos/vscode` (`https://github.com/microsoft/vscode`, shallow `--depth 1` clone). <!-- brandlint-ok: functional clone URL of the reference repo --> Useful for implementation patterns when extending `apps/extension` (TreeView, terminal, and theming API usage) and for theme-token questions alongside `docs/agents/editor-theming-research.md`. **Reference for patterns, not a source to copy from** — it's MIT-licensed, but its internals are wired into VS Code's own service/DI layer, not the extension API surface `apps/extension` actually consumes. Re-clone/refresh it yourself if it's missing — it's intentionally not vendored here.

## Agent skills

### Issue tracker

Issues live as markdown files under `.scratch/<feature>/` (local tracker — no GitHub remote exists yet). See `docs/agents/issue-tracker.md`.

### Triage labels

Standard five-role labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### i18n

`docs/agents/i18n.md` documents the `react-i18next` setup the old Tauri desktop app used. `apps/extension` has no UI-string-heavy webview and doesn't use `react-i18next` — treat that doc as dormant/inapplicable to current work unless the extension later grows a webview UI substantial enough to need runtime language switching.
