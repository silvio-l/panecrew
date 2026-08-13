pub mod about;
pub mod cli;
pub mod explorer_fs;
pub mod external_editor;
pub mod git_status;
pub mod launch;
pub mod menu;
pub mod path_probe;
pub mod pty_commands;
pub mod pty_manager;
pub mod session_store;
pub mod shell_history;
pub mod shell_integration;
pub mod splash;
pub mod updater;

use about::PendingUpdateCheck;
use cli::Cli;
use launch::LaunchProject;
use pty_commands::{PtyState, ShellIntegrationDir};
use splash::RevealGate;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // nosemgrep: rust.lang.security.args-os.args-os -- argv only selects which project folder to open; launch::resolve_launch_project validates it against the real filesystem and falls back to the picker on anything invalid, so a spoofed argv has no security consequence.
    let cli = Cli::parse_args(std::env::args_os());
    let launch_cwd = std::env::current_dir().unwrap_or_default();
    let launch_project = launch::resolve_launch_project(cli.project.as_deref(), &launch_cwd);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(PtyState::default())
        .manage(LaunchProject(launch_project))
        .manage(RevealGate::default())
        .manage(PendingUpdateCheck::default())
        .menu(menu::build)
        .on_menu_event(|app, event| match event.id().as_ref() {
            menu::ABOUT => about::show(app, false),
            menu::CHECK_UPDATES => about::show(app, true),
            _ => {}
        })
        .on_window_event(about::on_window_event)
        .setup(|app| {
            // Written once here rather than per spawn, so concurrently opening
            // panes can't race on the same three files. A failure is
            // survivable: panes then run the user's shell exactly as before,
            // without PaneCrew's prompt and without cwd reporting.
            let root = app
                .path()
                .app_config_dir()
                .map(|dir| dir.join("shell-integration"))
                .ok()
                .filter(|root| match shell_integration::materialize(root) {
                    Ok(()) => true,
                    Err(error) => {
                        eprintln!("PaneCrew: shell integration unavailable: {error}");
                        false
                    }
                });
            app.manage(ShellIntegrationDir(root));
            splash::arm_watchdog(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pty_commands::pty_spawn,
            pty_commands::pty_write,
            pty_commands::pty_resize,
            pty_commands::pty_kill,
            shell_history::shell_history_read,
            explorer_fs::explorer_read_tree,
            explorer_fs::explorer_read_dir,
            explorer_fs::explorer_search_names,
            explorer_fs::explorer_read_file,
            explorer_fs::explorer_write_file,
            explorer_fs::explorer_create_file,
            explorer_fs::explorer_create_directory,
            explorer_fs::explorer_rename,
            explorer_fs::explorer_delete,
            external_editor::vscode_is_installed,
            external_editor::vscode_open,
            git_status::explorer_git_status,
            path_probe::path_is_directory,
            path_probe::list_subdirectories,
            launch::get_launch_project,
            session_store::session_load,
            session_store::session_save,
            splash::splash_visible,
            splash::splash_finished,
            splash::main_ready,
            about::about_take_update_request,
            about::about_visible,
            updater::updater_is_homebrew_install,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
