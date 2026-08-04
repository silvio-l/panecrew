pub mod pty_commands;
pub mod pty_manager;
pub mod shell_history;

use pty_commands::PtyState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(PtyState::default())
        .invoke_handler(tauri::generate_handler![
            pty_commands::pty_spawn,
            pty_commands::pty_write,
            pty_commands::pty_resize,
            pty_commands::pty_kill,
            shell_history::shell_history_read,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
