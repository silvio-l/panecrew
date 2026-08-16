// [DEBUG-a4f2] Throwaway capture for the intermittent context-menu bug
// (PaneTabs.tsx). The user can't hand over the running app's WKWebView
// console, so this mirrors every log line into a file via the Rust-side
// `debug_a4f2_log` command (src-tauri/src/debug_capture.rs) as well. Delete
// this file, its PaneTabs.tsx import, and the Rust side once the bug is
// fixed (grep `DEBUG-a4f2`).
import { invoke } from "@tauri-apps/api/core";

export function logBug2(line: string): void {
  const stamped = `${new Date().toISOString()} ${line}`;
  console.log(`[DEBUG-a4f2] ${stamped}`);
  void invoke("debug_a4f2_log", { line: stamped }).catch(() => {
    // Kein zweiter Kanal mehr übrig — die Konsolenzeile oben bleibt trotzdem stehen.
  });
}
