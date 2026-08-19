pub mod about;
pub mod cli;
pub mod config_core;
pub mod config_manifest;
pub mod config_registry;
#[cfg(target_os = "macos")]
pub mod dock;
pub mod explorer_fs;
pub mod explorer_watch;
pub mod external_editor;
pub mod git_status;
pub mod json_store;
pub mod launch;
pub mod logging;
pub mod menu;
pub mod onboarding_store;
pub mod path_probe;
pub mod pty_commands;
pub mod pty_manager;
pub mod resource_guard;
pub mod resource_monitor;
pub mod session_store;
pub mod settings_commands;
pub mod settings_store;
pub mod settings_window;
pub mod shell_history;
pub mod shell_integration;
pub mod snippet_fs;
pub mod splash;
pub mod tool_detect;
pub mod updater;
pub mod window_state;
pub mod windows;

use about::PendingUpdateCheck;
use cli::Cli;
use config_registry::ConfigRegistry;
use explorer_watch::ExplorerWatchState;
use launch::LaunchProject;
use pty_commands::{PtyState, ShellIntegrationDir, WindowPtyRegistry};
use resource_guard::ResourceGuardState;
use session_store::SessionWriteLock;
use settings_commands::ConfigRegistryState;
use splash::RevealGate;
use std::sync::Mutex;
use tauri::{Emitter, Manager, RunEvent};
use tool_detect::ToolDetector;
use windows::{ConfirmedCloseWindows, DeferredQuitState, PendingWindowProjects, QuittingFlag};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // nosemgrep: rust.lang.security.args-os.args-os -- argv only selects which project folder to open; launch::resolve_launch_project validates it against the real filesystem and falls back to the picker on anything invalid, so a spoofed argv has no security consequence.
    let cli = Cli::parse_args(std::env::args_os());
    let launch_cwd = std::env::current_dir().unwrap_or_default();
    let launch_project = launch::resolve_launch_project(cli.project.as_deref(), &launch_cwd);

    // Registered once at startup, before any command can read/write a
    // setting — core settings go through the exact same public
    // `ConfigRegistry::register` API an extension's manifest parsing will
    // use later (`config_manifest.rs`), so this call can never fail in
    // practice; a failure here would mean two core entries collided, which
    // is a programming error worth surfacing loudly rather than swallowing.
    let mut config_registry = ConfigRegistry::new();
    config_core::register_core_settings(&mut config_registry)
        .expect("core settings must register without namespace/duplicate conflicts");

    log::info!("PaneCrew {} starting", env!("CARGO_PKG_VERSION"));

    tauri::Builder::default()
        .plugin(logging::plugin())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(PtyState::default())
        .manage(WindowPtyRegistry::default())
        .manage(ToolDetector::default())
        .manage(LaunchProject(launch_project))
        .manage(RevealGate::default())
        .manage(PendingUpdateCheck::default())
        .manage(ConfigRegistryState(Mutex::new(config_registry)))
        .manage(QuittingFlag::default())
        .manage(ConfirmedCloseWindows::default())
        .manage(PendingWindowProjects::default())
        .manage(DeferredQuitState::default())
        .manage(ExplorerWatchState::default())
        .manage(ResourceGuardState::default())
        .manage(SessionWriteLock::default())
        .manage(window_state::WindowStateStore::default())
        // Not `.menu(menu::build)`: Tauri evaluates that closure while
        // building the `App` itself, before `register_core_plugins()` has
        // managed the internal `PathResolver` state -- and `menu::build`
        // reaches `session_store::recent_projects` -> `app.path()` to list
        // recent projects, which panics ("state() called before manage()")
        // at that point. `menu::refresh()` below runs from `.setup()`,
        // after core plugins are ready, and is the same build-then-set_menu
        // path already used for every later menu rebuild (window
        // focus/close, see `.on_window_event` below).
        .enable_macos_default_menu(false)
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            log::debug!("menu event: {id}");
            match id {
                menu::ABOUT => about::show(app, false),
                menu::CHECK_UPDATES => about::show(app, true),
                menu::OPEN_SETTINGS => {
                    if let Some(window) = windows::focused_content_window(app) {
                        // `WebviewWindow`'s eigenes `window`-Feld ist crate-privat (Tauri-
                        // intern) — der öffentliche Weg zum `Window` geht über
                        // `AsRef<Webview<R>>` + `Webview::window()`, demselben Pfad, den
                        // Tauris eigener `CommandArg`-Extractor für `WebviewWindow` intern
                        // nimmt.
                        let webview: &tauri::Webview<_> = window.as_ref();
                        settings_window::show(app, &webview.window());
                    }
                }
                menu::OPEN_FOLDER => {
                    if let Some(window) = windows::focused_content_window(app) {
                        let _ = window.emit_to(window.label(), menu::EVENT_OPEN_FOLDER, ());
                    }
                }
                menu::SHOW_SHORTCUTS => {
                    if let Some(window) = windows::focused_content_window(app) {
                        let _ = window.emit_to(window.label(), menu::EVENT_SHOW_SHORTCUTS, ());
                    }
                }
                menu::SHOW_COMMAND_PALETTE => {
                    if let Some(window) = windows::focused_content_window(app) {
                        let _ = window.emit_to(window.label(), menu::EVENT_SHOW_COMMAND_PALETTE, ());
                    }
                }
                menu::CLOSE_WINDOW => {
                    if let Some(window) = windows::focused_content_window(app) {
                        let _ = window.close();
                    }
                }
                _ if id.starts_with(menu::RECENT_PROJECT_ITEM_PREFIX) => {
                    let path = &id[menu::RECENT_PROJECT_ITEM_PREFIX.len()..];
                    if let Some(window) = windows::focused_content_window(app) {
                        let _ = window.emit_to(window.label(), menu::EVENT_OPEN_RECENT_PROJECT, path);
                    }
                }
                menu::CLOSE_ALL_WINDOWS => {
                    for window in windows::content_windows(app) {
                        let _ = window.close();
                    }
                }
                _ if id.starts_with(menu::WINDOW_ITEM_PREFIX) => {
                    let label = &id[menu::WINDOW_ITEM_PREFIX.len()..];
                    if let Some(window) = app.get_webview_window(label) {
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                }
                #[cfg(target_os = "macos")]
                _ if id == dock::NEW_WINDOW_ITEM_ID => {
                    if let Err(error) = windows::window_open_new(app.clone(), None) {
                        log::warn!("new window from dock menu failed: {error}");
                    }
                }
                _ => {}
            }
        })
        .on_window_event(|window, event| {
            about::on_window_event(window, event);
            windows::on_window_event(window, event);
            settings_window::on_window_event(window, event);
            // Mirrors the PTY registry's own per-window cleanup
            // (`pty_commands::kill_all_for_window`, called from
            // `windows::on_window_event` above): a closed window's explorer
            // watch must not keep its background thread alive for the rest
            // of the process's life just because a sibling window is still
            // open.
            if let tauri::WindowEvent::Destroyed = event {
                explorer_watch::stop_for_window(window.app_handle(), window.label());
            }
            // Hält die dynamische "Fenster"-Menüliste (menu.rs) aktuell:
            // ohne Rebuild bei jedem Fokuswechsel bliebe der Haken beim
            // zuletzt fokussierten Fenster hängen, und ein zerstörtes
            // Fenster stünde als toter Eintrag weiter drin (ein Klick
            // darauf fände via `get_webview_window` ohnehin nichts mehr,
            // aber sichtbar tot wäre er trotzdem falsch).
            if matches!(
                event,
                tauri::WindowEvent::Destroyed | tauri::WindowEvent::Focused(true)
            ) {
                menu::refresh(window.app_handle());
            }
        })
        .setup(|app| {
            // Core plugins (incl. the `PathResolver` state `app.path()`
            // needs) are managed by now, unlike during `.menu(menu::build)`
            // above -- see the comment there.
            menu::refresh(app.handle());

            // See `ShellIntegrationDir`'s own doc comment for why this starts
            // as `None` and who fills it in.
            app.manage(ShellIntegrationDir(Mutex::new(None)));

            // Ticket 04 (perf audit): none of `.setup()`'s filesystem-writing
            // or window-building work may run synchronously here, or the
            // splash's first frame can't render until all of it finishes.
            // Written once per launch rather than per spawn, so concurrently
            // opening panes can't race on the same three files. A failure is
            // survivable: panes then run the user's shell exactly as before,
            // without PaneCrew's prompt and without cwd reporting.
            let integration_handle = app.handle().clone();
            std::thread::spawn(move || {
                let Ok(root) = integration_handle
                    .path()
                    .app_config_dir()
                    .map(|dir| dir.join("shell-integration"))
                else {
                    return;
                };
                match shell_integration::materialize(&root) {
                    Ok(()) => {
                        let state = integration_handle.state::<ShellIntegrationDir>();
                        *state.0.lock().expect("shell integration dir poisoned") = Some(root);
                    }
                    Err(error) => log::warn!("shell integration unavailable: {error}"),
                }
            });

            #[cfg(target_os = "macos")]
            dock::install(app.handle());

            // `restore_persisted_windows` only synchronously reads
            // `session.json` (cheap) here — it queues each window's own
            // `build()` call onto the main thread itself (ticket 07), so
            // `.setup()` still returns immediately without waiting on any of
            // them.
            windows::restore_persisted_windows(app.handle());

            let settings_handle = app.handle().clone();
            if let Err(error) = app.handle().run_on_main_thread(move || {
                settings_window::prewarm(&settings_handle);
            }) {
                log::warn!("failed to queue settings-window prewarm: {error}");
            }

            splash::position_on_launch_monitor(app.handle());
            splash::arm_watchdog(app.handle());
            resource_monitor::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pty_commands::pty_spawn,
            pty_commands::pty_write,
            pty_commands::pty_resize,
            pty_commands::pty_kill,
            pty_commands::pty_detect_tool,
            resource_guard::resource_guard_resume,
            resource_guard::resource_guard_kill_manual,
            shell_history::shell_history_read,
            explorer_fs::explorer_read_dir,
            explorer_fs::explorer_search_names,
            explorer_fs::explorer_search_contents,
            explorer_fs::explorer_read_file,
            explorer_fs::explorer_read_media,
            explorer_fs::explorer_write_file,
            explorer_fs::explorer_create_file,
            explorer_fs::explorer_create_directory,
            explorer_fs::explorer_rename,
            explorer_fs::explorer_delete,
            explorer_watch::explorer_watch_start,
            explorer_watch::explorer_watch_stop,
            external_editor::vscode_is_installed,
            external_editor::vscode_open,
            git_status::explorer_git_status,
            path_probe::path_is_directory,
            path_probe::list_subdirectories,
            launch::get_launch_project,
            snippet_fs::snippet_init,
            session_store::session_load,
            session_store::session_save,
            session_store::session_save_window,
            session_store::session_remove_window,
            splash::splash_visible,
            splash::splash_finished,
            splash::main_ready,
            about::about_take_update_request,
            about::about_visible,
            updater::updater_is_homebrew_install,
            settings_commands::settings_get_schema,
            settings_commands::settings_get_values,
            settings_commands::settings_set_value,
            settings_commands::settings_reset_value,
            settings_commands::settings_read_raw,
            settings_commands::settings_write_raw,
            settings_commands::settings_open_window,
            settings_window::settings_visible,
            onboarding_store::onboarding_get_state,
            onboarding_store::onboarding_set_completed,
            onboarding_store::onboarding_set_wizard_completed,
            onboarding_store::onboarding_restart,
            windows::window_open_new,
            windows::take_pending_window_project,
            windows::window_close_confirmed,
            window_state::window_state_publish,
            window_state::window_state_snapshot,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            // Ticket 27, landmine 3: the only reliable "the whole app is
            // quitting, not just one window closing" signal Tauri exposes.
            // Fired once, before any of the per-window `CloseRequested`
            // events below it in the same quit sequence — setting the flag
            // here is what lets `windows::on_window_event` tell the two
            // cases apart.
            if let RunEvent::ExitRequested { .. } = event {
                app_handle.state::<QuittingFlag>().set();
            }
        });
}
