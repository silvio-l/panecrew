// Thin re-export of @tauri-apps/plugin-log so every call site in this app
// goes through one module instead of scattered direct plugin imports — a
// single swap point if the sink ever changes. Calls here are forwarded by
// the plugin into the same rotating file the Rust side writes to
// (src-tauri/src/logging.rs's doc comment), not just the devtools console.
//
// Never log PTY/terminal I/O content, file contents, or search queries —
// this app hosts arbitrary CLI tools including coding agents, and that
// traffic routinely carries credentials/secrets.
export { debug, info, warn, error } from "@tauri-apps/plugin-log";
