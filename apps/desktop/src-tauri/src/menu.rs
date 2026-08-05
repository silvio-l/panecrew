use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Runtime};

pub const ABOUT: &str = "about";
pub const CHECK_UPDATES: &str = "check-updates";

/// Eigenes Menü statt `Menu::default`: dessen macOS-App-Menü öffnet an erster
/// Stelle das native About-Panel, und genau die Stelle braucht das eigene
/// Über-Fenster. Der Rest ist deshalb nicht Kür — wer das Standardmenü ersetzt,
/// muss Beenden, Schließen und die Bearbeiten-Befehle selbst wieder
/// mitbringen, sonst fallen deren Systemkürzel ersatzlos weg.
///
/// Die Beschriftungen stehen auf Deutsch wie die übrige Oberfläche. Tauris
/// vordefinierte Einträge tragen sonst durchgehend englische Texte (muda
/// lokalisiert nicht), also wäre der Menübalken sonst zweisprachig.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let about = MenuItem::with_id(app, ABOUT, "Über PaneCrew", true, None::<&str>)?;
    let check_updates = MenuItem::with_id(
        app,
        CHECK_UPDATES,
        "Nach Updates suchen …",
        true,
        None::<&str>,
    )?;

    let edit = Submenu::with_items(
        app,
        "Bearbeiten",
        true,
        &[
            &PredefinedMenuItem::undo(app, Some("Widerrufen"))?,
            &PredefinedMenuItem::redo(app, Some("Wiederholen"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("Ausschneiden"))?,
            &PredefinedMenuItem::copy(app, Some("Kopieren"))?,
            &PredefinedMenuItem::paste(app, Some("Einsetzen"))?,
            &PredefinedMenuItem::select_all(app, Some("Alles auswählen"))?,
        ],
    )?;

    #[cfg(target_os = "macos")]
    {
        // Kein Eintrag für den Zoom der App (Cmd +/-/0): den fängt die
        // Shortcut-Registry im Webview ab, ein Menükürzel würde ihn abfangen,
        // bevor er dort ankommt.
        Menu::with_items(
            app,
            &[
                &Submenu::with_items(
                    app,
                    "PaneCrew",
                    true,
                    &[
                        &about,
                        &check_updates,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::services(app, Some("Dienste"))?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::hide(app, Some("PaneCrew ausblenden"))?,
                        &PredefinedMenuItem::hide_others(app, Some("Andere ausblenden"))?,
                        &PredefinedMenuItem::show_all(app, Some("Alle einblenden"))?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::quit(app, Some("PaneCrew beenden"))?,
                    ],
                )?,
                &Submenu::with_items(
                    app,
                    "Ablage",
                    true,
                    &[&PredefinedMenuItem::close_window(app, Some("Schließen"))?],
                )?,
                &edit,
                &Submenu::with_items(
                    app,
                    "Darstellung",
                    true,
                    &[&PredefinedMenuItem::fullscreen(app, Some("Vollbild"))?],
                )?,
                &Submenu::with_items(
                    app,
                    "Fenster",
                    true,
                    &[
                        &PredefinedMenuItem::minimize(app, Some("Im Dock ablegen"))?,
                        &PredefinedMenuItem::maximize(app, Some("Zoomen"))?,
                    ],
                )?,
            ],
        )
    }

    #[cfg(not(target_os = "macos"))]
    {
        // Ohne App-Menü gehört „Über" nach Windows-Konvention ins Hilfe-Menü.
        Menu::with_items(
            app,
            &[
                &Submenu::with_items(
                    app,
                    "Datei",
                    true,
                    &[
                        &PredefinedMenuItem::close_window(app, Some("Schließen"))?,
                        &PredefinedMenuItem::quit(app, Some("Beenden"))?,
                    ],
                )?,
                &edit,
                &Submenu::with_items(app, "Hilfe", true, &[&about, &check_updates])?,
            ],
        )
    }
}
