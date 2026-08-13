//! Detecting and launching VS Code as an external editor for the explorer's — brandlint-ok: funktionale Nennung, echtes Zielprogramm dieser Datei
//! "Open in VS Code" context menu entry. — brandlint-ok: funktionale Nennung, echtes Zielprogramm dieser Datei
//!
//! Bundle-path checks, not a `PATH` lookup for the `code` CLI: a GUI app
//! launched from Finder/the Dock inherits a minimal `PATH` that usually
//! excludes whatever a shell rc file added, so `which code` is unreliable
//! precisely for the users who installed VS Code the normal way (drag to — brandlint-ok: funktionale Nennung, echtes Zielprogramm dieser Datei
//! `/Applications`, never ran "Shell Command: Install 'code' command in
//! PATH"). Checking for the `.app` bundle itself has no such dependency.
//! `which`/`where` stays as a fallback for the case that *does* have the CLI
//! on `PATH` but the bundle somewhere this doesn't look (a non-standard
//! install location, a Linux `.deb`/`.rpm` install).

use std::path::PathBuf;
use std::process::Command;

#[cfg(target_os = "macos")]
fn is_installed() -> bool {
    let mut candidates = vec![PathBuf::from("/Applications/Visual Studio Code.app")]; // brandlint-ok: funktionale Nennung, realer App-Bundle-Name für die Installationsprüfung
    if let Ok(home) = std::env::var("HOME") {
        candidates.push(PathBuf::from(home).join("Applications/Visual Studio Code.app")); // brandlint-ok: funktionale Nennung, realer App-Bundle-Name für die Installationsprüfung
    }
    candidates.iter().any(|candidate| candidate.exists()) || is_on_path()
}

#[cfg(target_os = "windows")]
fn is_installed() -> bool {
    let mut candidates = Vec::new();
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        candidates
            .push(PathBuf::from(local_app_data).join("Programs\\Microsoft VS Code\\Code.exe")); // brandlint-ok: funktionale Nennung, realer Installationspfad für die Installationsprüfung
    }
    if let Ok(program_files) = std::env::var("ProgramFiles") {
        candidates.push(PathBuf::from(program_files).join("Microsoft VS Code\\Code.exe")); // brandlint-ok: funktionale Nennung, realer Installationspfad für die Installationsprüfung
    }
    candidates.iter().any(|candidate| candidate.exists()) || is_on_path()
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn is_installed() -> bool {
    is_on_path()
}

fn is_on_path() -> bool {
    let finder = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };
    Command::new(finder)
        .arg("code")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// Whether VS Code appears to be installed on this machine — the guard for — brandlint-ok: funktionale Nennung, echtes Zielprogramm dieser Datei
/// whether the explorer's "Open in VS Code" entry should render at all. — brandlint-ok: funktionale Nennung, echtes Zielprogramm dieser Datei
/// Stateless and cheap enough (a handful of `Path::exists` calls, or one
/// subprocess in the fallback case) to call on demand rather than caching
/// anything on the Rust side; the frontend memoizes its own call for the
/// session instead.
#[tauri::command]
pub fn vscode_is_installed() -> bool {
    is_installed()
}

/// Opens `path` (a file or a directory) in VS Code. — brandlint-ok: funktionale Nennung, echtes Zielprogramm dieser Datei
///
/// macOS uses `open -a`, not a direct `Code.app/Contents/MacOS/Electron` — brandlint-ok: funktionale Nennung, echter Prozessname zur Abgrenzung des Startwegs
/// invocation or the `code` CLI: `open -a` resolves the app by name through
/// Launch Services, so it works regardless of where exactly the bundle sits
/// and never depends on `PATH`, mirroring the detection above. Every other
/// platform falls back to the `code` CLI, since `open -a`'s app-by-name
/// resolution is macOS-specific.
#[tauri::command]
pub fn vscode_open(path: String) -> Result<(), String> {
    let result = if cfg!(target_os = "macos") {
        Command::new("open")
            .args(["-a", "Visual Studio Code", &path]) // brandlint-ok: funktionale Nennung, realer App-Name für Launch Services
            .spawn()
    } else {
        Command::new("code").arg(&path).spawn()
    };
    result
        .map(|_child| ())
        .map_err(|error| format!("VS Code konnte nicht gestartet werden: {error}")) // brandlint-ok: funktionale Nennung, echtes Zielprogramm dieser Datei
}
