# Changelog

Jeder Eintrag hier ist **Voraussetzung fürs Release-CI**, nicht nur Doku: Ein
Tag-Push (`app-v*` für Stable, der rollierende `nightly-latest` für Nightly)
löst `tools/changelog-gate/check.py` aus, das den Eintrag ganz oben gegen den
echten `git diff` seit dem letzten Kanal-Tag prüft — fehlt ein betroffenes
Modul in `coverage`, oder passt `diff_hash` nicht mehr zum tatsächlichen
Diff (weil seither neuer Code dazukam), schlägt der Release-Build fehl.
Kein Autogenerator: der Freitext muss inhaltlich geschrieben werden.
Mechanismus und Begründung: `docs/decisions.md` → "Auto-Update via GitHub
Releases", Punkt 5.

## Format

```
## [X.Y.Z] - JJJJ-MM-TT
---
coverage:
  - modul-a
  - modul-b
diff_hash: <von check.py berechneter sha256-Hex-Digest>
---
Freitext-Beschreibung der Änderungen seit dem letzten Release dieses Kanals.
```

- `coverage` muss **jedes** Modul enthalten, das der reale Diff seit dem
  letzten Tag dieses Kanals berührt (Pfad→Modul-Mapping:
  `tools/changelog-gate/module_map.json`; ein noch nicht gemappter Pfad wird
  automatisch sein eigenes Ad-hoc-Modul und muss trotzdem abgedeckt sein).
- `diff_hash` wird nicht von Hand geschrieben — `check.py` gibt ihn bei einem
  Fehlschlag aus, der Wert wird 1:1 in den Eintrag übernommen. Ändert sich der
  Diff danach nochmal, muss der Hash neu übernommen werden.
- Neueste Version steht oben (umgekehrt chronologisch); das Gate liest nur
  den **ersten** `## [...]`-Block der Datei.

## [0.1.0] - 2026-08-13
---
coverage:
  - .gitignore
  - .gitleaks.toml
  - .ossallowlist
  - CHANGELOG.md
  - LICENSE
  - README.md
  - SECURITY.md
  - about
  - apps/desktop/.gitignore
  - apps/desktop/README.md
  - apps/desktop/about.html
  - apps/desktop/eslint.config.js
  - apps/desktop/harness.html
  - apps/desktop/index.html
  - apps/desktop/knip.jsonc
  - apps/desktop/package.json
  - apps/desktop/public/favicon-32.png
  - apps/desktop/public/favicon.png
  - apps/desktop/public/harness-storyboards/.gitkeep
  - apps/desktop/public/splash.mp4
  - apps/desktop/scripts/generate-shortcuts-docs.ts
  - apps/desktop/scripts/install-release-driver.sh
  - apps/desktop/shell-integration/panecrew.bashrc
  - apps/desktop/shell-integration/panecrew.zshenv
  - apps/desktop/shell-integration/panecrew.zshrc
  - apps/desktop/src-tauri/.gitignore
  - apps/desktop/src-tauri/Cargo.lock
  - apps/desktop/src-tauri/build.rs
  - apps/desktop/src-tauri/examples/gen_cli_docs.rs
  - apps/desktop/src-tauri/icons/128x128.png
  - apps/desktop/src-tauri/icons/128x128@2x.png
  - apps/desktop/src-tauri/icons/32x32.png
  - apps/desktop/src-tauri/icons/64x64.png
  - apps/desktop/src-tauri/icons/Square107x107Logo.png
  - apps/desktop/src-tauri/icons/Square142x142Logo.png
  - apps/desktop/src-tauri/icons/Square150x150Logo.png
  - apps/desktop/src-tauri/icons/Square284x284Logo.png
  - apps/desktop/src-tauri/icons/Square30x30Logo.png
  - apps/desktop/src-tauri/icons/Square310x310Logo.png
  - apps/desktop/src-tauri/icons/Square44x44Logo.png
  - apps/desktop/src-tauri/icons/Square71x71Logo.png
  - apps/desktop/src-tauri/icons/Square89x89Logo.png
  - apps/desktop/src-tauri/icons/StoreLogo.png
  - apps/desktop/src-tauri/icons/icon.icns
  - apps/desktop/src-tauri/icons/icon.ico
  - apps/desktop/src-tauri/icons/icon.png
  - apps/desktop/src-tauri/icons/nightly/128x128.png
  - apps/desktop/src-tauri/icons/nightly/128x128@2x.png
  - apps/desktop/src-tauri/icons/nightly/32x32.png
  - apps/desktop/src-tauri/icons/nightly/icon.icns
  - apps/desktop/src-tauri/icons/nightly/icon.ico
  - apps/desktop/src-tauri/icons/source/generate-icons.sh
  - apps/desktop/src-tauri/icons/source/generate-nightly-badge.sh
  - apps/desktop/src-tauri/icons/source/panecrew-icon-master-macos-padded.png
  - apps/desktop/src-tauri/icons/source/panecrew-icon-master.png
  - apps/desktop/src-tauri/icons/source/panecrew-mark.svg
  - apps/desktop/src-tauri/tests/updater_e2e.rs
  - apps/desktop/src/App.test.tsx
  - apps/desktop/src/main.tsx
  - apps/desktop/src/test/jsdomStorageFix.ts
  - apps/desktop/src/test/setup.ts
  - apps/desktop/src/types/gitStatus.test.ts
  - apps/desktop/src/types/gitStatus.ts
  - apps/desktop/src/types/project.test.ts
  - apps/desktop/src/types/project.ts
  - apps/desktop/src/types/treeFilter.test.ts
  - apps/desktop/src/types/treeFilter.ts
  - apps/desktop/src/vite-env.d.ts
  - apps/desktop/tsconfig.json
  - apps/desktop/tsconfig.node.json
  - apps/desktop/vite.config.ts
  - apps/desktop/vitest.config.ts
  - apps/website/astro.config.mjs
  - apps/website/package.json
  - apps/website/public/CNAME
  - apps/website/public/robots.txt
  - apps/website/src/pages/index.astro
  - apps/website/tsconfig.json
  - chrome
  - ci
  - cli
  - docs
  - explorer
  - harness
  - i18n
  - package.json
  - packages/.gitkeep
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
  - pty
  - release-config
  - session
  - splash
  - theme
  - tooling
  - updater
diff_hash: PLACEHOLDER
---
Erster Release überhaupt (weder Stable noch Nightly existierte vorher) —
deckt den gesamten bisherigen Projektstand ab: Grid-Mechanik, Fokus-folgende
Explorer-Anbindung, Session-Persistenz, PTY-Terminal, CLI-Launch-Parameter,
Tastenkürzel-Registry, Theming-Grundlagen, Demo-Harness/Promo-Pipeline,
Auto-Updater (tauri-plugin-updater, Stable-/Nightly-Kanal-Overlays,
In-App-Update-UX) sowie das Release-CI samt diesem Changelog-Gate selbst.
Erstes tatsächlich getaggtes Release ist der Nightly-Kanal
(`nightly-latest`); Stable folgt, sobald eine erste stabile Version steht.
