//! General-purpose logging sink (Rust + frontend), not tied to any one bug.
//!
//! Replaces the earlier throwaway `[DEBUG-a4f2]` capture (a single hand-rolled
//! `invoke` command writing straight into `app_config_dir`) with the standard
//! `tauri-plugin-log`: it forwards both `log::*!` calls here and the
//! frontend's `@tauri-apps/plugin-log` calls into one rotating file in the
//! OS-standard log directory (`~/Library/Logs/dev.panecrew.desktop/` on
//! macOS), so a bug report can include the log file without the user needing
//! to hand over a running app's WKWebView console.
//!
//! Never log PTY/terminal I/O content, file contents, or search queries —
//! this app hosts arbitrary CLI tools including coding agents, and that
//! traffic routinely carries credentials/secrets. Log the fact of an action
//! (spawned, closed, failed) and byte counts if useful, never the bytes.
use tauri::{Runtime, plugin::TauriPlugin};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};

const MAX_FILE_SIZE_BYTES: u128 = 5 * 1024 * 1024;

/// `PANECREW_LOG=debug` (or `trace`/`warn`/`error`) overrides the default
/// `info` level for a one-off diagnostic run, without needing a rebuild.
fn level_from_env() -> log::LevelFilter {
    match std::env::var("PANECREW_LOG").ok().as_deref() {
        Some("trace") => log::LevelFilter::Trace,
        Some("debug") => log::LevelFilter::Debug,
        Some("warn") => log::LevelFilter::Warn,
        Some("error") => log::LevelFilter::Error,
        Some("off") => log::LevelFilter::Off,
        _ => log::LevelFilter::Info,
    }
}

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    let mut targets = vec![Target::new(TargetKind::LogDir {
        file_name: Some("panecrew".to_string()),
    })];
    // Stdout only in dev builds: a packaged app has no attached terminal to
    // read it from, and formatting it is wasted work at real usage volume.
    if cfg!(debug_assertions) {
        targets.push(Target::new(TargetKind::Stdout));
    }

    tauri_plugin_log::Builder::new()
        .targets(targets)
        .level(level_from_env())
        // `KeepSome(3)`, not `KeepAll` — this is a long-running desktop app;
        // unbounded rotation would grow the log directory forever.
        .rotation_strategy(RotationStrategy::KeepSome(3))
        .max_file_size(MAX_FILE_SIZE_BYTES)
        .build()
}
