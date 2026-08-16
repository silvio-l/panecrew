//! [DEBUG-a4f2] Throwaway capture for the intermittent context-menu bug
//! (PaneTabs.tsx). Appends timestamped lines from the frontend to a log file
//! outside the WKWebView console, which the user has no way to hand over from
//! the running app. Delete this whole file plus its `mod`/invoke_handler
//! wiring once the bug is fixed (grep `DEBUG-a4f2`).
use tauri::{AppHandle, Manager, Runtime};

#[tauri::command]
pub fn debug_a4f2_log<R: Runtime>(app: AppHandle<R>, line: String) -> Result<(), String> {
    use std::io::Write;

    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("app_config_dir unavailable: {error}"))?;
    std::fs::create_dir_all(&dir).map_err(|error| format!("mkdir failed: {error}"))?;
    let path = dir.join("debug-a4f2.log");
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| format!("open failed: {error}"))?;
    writeln!(file, "{line}").map_err(|error| format!("write failed: {error}"))?;
    Ok(())
}
