use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, Runtime};

pub const ABOUT: &str = "about";
pub const CHECK_UPDATES: &str = "check-updates";
/// Gefolgt vom Fenster-Label (`window_open_new`s zurückgegebenem Wert) —
/// `on_menu_event` in `lib.rs` schneidet das wieder ab, um das Ziel-Fenster
/// zu adressieren.
pub const WINDOW_ITEM_PREFIX: &str = "window:";

/// Ein `CheckMenuItem` je offenem Inhalts-Fenster (`windows::is_content_window`
/// — schließt „about"/„settings" aus), Haken beim gerade fokussierten. Das ist
/// die native macOS-„Fenster"-Menü-Konvention (jede echte AppKit-App listet
/// hier ihre offenen Fenster), die Tauris Menü-API anders als natives AppKit
/// NICHT von selbst mitbringt — ohne das hier bleibt ein Fenster ohne eigenes
/// Dock-Icon (normal, eine App hat nur eins) UND ohne Menü-Eintrag komplett
/// unauffindbar, sobald es minimiert oder auf einem anderen Space liegt
/// (2026-08-14 Nutzerbefund: nur über App-Exposé wiedergefunden).
///
/// Sortiert nach Label statt Erzeugungsreihenfolge: Letztere wird nirgends
/// separat mitgeführt, und `nanoid()`s Zeitstempel-Suffix ist ohnehin nicht
/// dafür gedacht, danach sortiert zu werden — Label-Sortierung ist dafür
/// wenigstens über Rebuilds hinweg stabil. `MAIN` ("main") sortiert dabei
/// immer zuerst (kürzerer String, Präfix jedes `"main-…"`-Labels), bekommt
/// also zuverlässig den nummernlosen Titel.
fn window_items<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Vec<CheckMenuItem<R>>> {
    let windows = app.webview_windows();
    let focused_label = windows
        .values()
        .find(|w| w.is_focused().unwrap_or(false))
        .map(|w| w.label().to_string());
    let mut labels: Vec<String> = windows
        .keys()
        .filter(|label| crate::windows::is_content_window(label))
        .cloned()
        .collect();
    labels.sort();

    labels
        .iter()
        .enumerate()
        .map(|(index, label)| {
            let title = if label == crate::windows::MAIN {
                "PaneCrew".to_string()
            } else {
                format!("PaneCrew — Fenster {}", index + 1)
            };
            let checked = focused_label.as_deref() == Some(label.as_str());
            CheckMenuItem::with_id(
                app,
                format!("{WINDOW_ITEM_PREFIX}{label}"),
                title,
                true,
                checked,
                None::<&str>,
            )
        })
        .collect()
}

/// Baut die komplette Menüleiste neu und installiert sie — der einzige Weg,
/// ein neu geöffnetes/geschlossenes/fokussiertes Fenster in der „Fenster"-
/// Liste widerzuspiegeln, da Tauris Menü-API kein gezieltes Nachrüsten
/// einzelner Einträge in ein bereits gesetztes Menü anbietet. macOS hat
/// ohnehin nur EINE Menüleiste für den ganzen Prozess, unabhängig vom
/// fokussierten Fenster — ein kompletter Ersatz ist hier also korrekt, kein
/// Umweg. Fehler (z. B. während des Herunterfahrens) werden bewusst
/// verschluckt: eine veraltete Menüleiste ist kein Absturzgrund.
pub fn refresh<R: Runtime>(app: &AppHandle<R>) {
    if let Ok(menu) = build(app) {
        let _ = app.set_menu(menu);
    }
}

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
        let minimize = PredefinedMenuItem::minimize(app, Some("Im Dock ablegen"))?;
        let maximize = PredefinedMenuItem::maximize(app, Some("Zoomen"))?;
        let window_separator = PredefinedMenuItem::separator(app)?;
        let window_list = window_items(app)?;
        let mut fenster_items: Vec<&dyn IsMenuItem<R>> = vec![&minimize, &maximize];
        if !window_list.is_empty() {
            fenster_items.push(&window_separator);
            for item in &window_list {
                fenster_items.push(item);
            }
        }
        let fenster = Submenu::with_items(app, "Fenster", true, &fenster_items)?;

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
                &fenster,
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
