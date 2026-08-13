import { invoke } from "@tauri-apps/api/core";

// Ob VS Code installiert ist, ändert sich nicht während einer laufenden — brandlint-ok: funktionale Nennung, Erkennung des real installierten Editors
// Session — ein Nutzer installiert es nicht mittendrin nach, während der
// Explorer offen ist. Ein modulweites, gecachtes Promise erspart deshalb
// jedem Rechtsklick einen neuen Rust-Aufruf (der auf macOS mehrere
// `Path::exists`-Prüfungen, im Fallback sogar einen Subprozess kostet); der
// erste Aufruf startet ihn, jeder weitere bekommt dasselbe Promise zurück.
let cached: Promise<boolean> | null = null;

export function vscodeIsInstalled(): Promise<boolean> {
  cached ??= invoke<boolean>("vscode_is_installed").catch(() => false);
  return cached;
}
