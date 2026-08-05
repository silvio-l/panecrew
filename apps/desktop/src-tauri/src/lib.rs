pub mod about;
pub mod cli;
pub mod explorer_fs;
pub mod git_status;
pub mod launch;
pub mod menu;
pub mod path_probe;
pub mod pty_commands;
pub mod pty_manager;
pub mod shell_history;
pub mod shell_integration;
pub mod splash;

use about::PendingUpdateCheck;
use cli::Cli;
use launch::LaunchProject;
use pty_commands::{PtyState, ShellIntegrationDir};
use splash::RevealGate;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cli = Cli::parse_args(std::env::args_os());
    let launch_cwd = std::env::current_dir().unwrap_or_default();
    let launch_project = launch::resolve_launch_project(cli.project.as_deref(), &launch_cwd);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
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
            explorer_fs::explorer_create_file,
            explorer_fs::explorer_create_directory,
            git_status::explorer_git_status,
            path_probe::path_is_directory,
            path_probe::list_subdirectories,
            launch::get_launch_project,
            splash::splash_visible,
            splash::splash_finished,
            splash::main_ready,
            about::about_take_update_request,
            about::about_visible,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
