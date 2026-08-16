use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Runtime};

pub const ABOUT: &str = "about";
pub const CHECK_UPDATES: &str = "check-updates";
/// macOS-Konvention: Cmd+, öffnet die Einstellungen, unabhängig vom Fenster,
/// das gerade fokussiert ist — dasselbe Muster wie `CLOSE_WINDOW`:
/// `on_menu_event` (lib.rs) ermittelt sich das Zielfenster über
/// `windows::focused_content_window` selbst, weil `settings_window::show`
/// einen "opener" zum Positionieren braucht (dessen Kopfkommentar: Settings
/// zentriert sich über dem AUFRUFENDEN Fenster, nicht über einem festen
/// Default-Monitor).
pub const OPEN_SETTINGS: &str = "open-settings";
/// "Ordner öffnen …" (Referenz-Editor-Menüaudit) — anders als `OPEN_SETTINGS`
/// braucht dieser Punkt kein zweites natives Fenster, sondern denselben
/// Ordner-Dialog, den `App.tsx`s `assignProjectToSlot` schon über einen
/// Toolbar-Klick auslöst. `on_menu_event` (lib.rs) emittiert dafür
/// `EVENT_OPEN_FOLDER` auf das fokussierte Inhalts-Fenster, statt selbst ein
/// Rust-seitiges Dialog-Plugin aufzurufen — dieselbe Emit-plus-`listen`-Brücke
/// wie `about.rs`s `"about:check-updates"`.
pub const OPEN_FOLDER: &str = "open-folder";
/// Frontend-Gegenstück: `App.tsx` hört per `listen(EVENT_OPEN_FOLDER, …)`.
pub const EVENT_OPEN_FOLDER: &str = "menu:open-folder";
/// Gefolgt vom Projektpfad selbst (der ist schon eindeutig, anders als
/// `WINDOW_ITEM_PREFIX`s Fenster-Label braucht es keine separate Lookup-
/// Tabelle) — `on_menu_event` (lib.rs) schneidet das wieder ab und emittiert
/// `EVENT_OPEN_RECENT_PROJECT` mit dem Pfad als Payload.
pub const RECENT_PROJECT_ITEM_PREFIX: &str = "recent-project:";
/// Frontend-Gegenstück: `App.tsx` hört per `listen(EVENT_OPEN_RECENT_PROJECT, …)`.
pub const EVENT_OPEN_RECENT_PROJECT: &str = "menu:open-recent-project";
/// Letzter der zehn Referenz-Editor-Menüaudit-Punkte: die in-App-
/// Kürzelreferenz (`ShortcutsReferenceDialog.tsx`) — dieselbe Emit-plus-
/// listen-Brücke wie `OPEN_FOLDER`, kein eigenes natives Fenster wie
/// `OPEN_SETTINGS`, weil der Dialog Teil des normalen React-Baums ist.
pub const SHOW_SHORTCUTS: &str = "show-shortcuts";
/// Frontend-Gegenstück: `App.tsx` hört per `listen(EVENT_SHOW_SHORTCUTS, …)`.
pub const EVENT_SHOW_SHORTCUTS: &str = "menu:show-shortcuts";
/// Nur macOS (s. `build`s `Ablage`-Submenü) — `PredefinedMenuItem::close_window`
/// bringt dort sein eigenes Cmd+W als OS-Menü-Akzelerator mit, AppKit löst das
/// VOR jedem Webview-Keydown auf und hätte damit exakt dasselbe Kürzel wie
/// `pane.closeTerminalTab` (registry.ts) abgegriffen — derselbe Konflikt, den
/// der Kommentar zur Zoom-Trias unten für +/-/0 bereits vermeidet. Eigenes
/// Item mit Cmd+Shift+W (verbreitete Konvention bei Browsern und beim
/// Referenz-Editor: W = Tab, Shift+W = Fenster) statt PredefinedMenuItem,
/// `on_menu_event` in `lib.rs` löst das fokussierte Fenster selbst auf und
/// ruft `close()` — das läuft weiter über `windows::on_window_event`s
/// `CloseRequested`-Rückfrage-Gate.
pub const CLOSE_WINDOW: &str = "close-window";
/// Konvention verbreiteter macOS-Browser: "Alle Fenster schließen" (⌥⇧⌘W,
/// Nutzer-Vorlage 2026-08-16), macOS-only wie `CLOSE_WINDOW`. Iteriert einfach über jedes
/// Inhalts-Fenster und ruft je `close()` — jedes davon durchläuft dabei
/// individuell dasselbe `CloseRequested`-Rückfrage-Gate wie ein einzelnes
/// Schließen, keine eigene "alle auf einmal wegwerfen"-Sonderlogik nötig.
pub const CLOSE_ALL_WINDOWS: &str = "close-all-windows";
/// Gefolgt vom Fenster-Label (`window_open_new`s zurückgegebenem Wert) —
/// `on_menu_event` in `lib.rs` schneidet das wieder ab, um das Ziel-Fenster
/// zu adressieren.
pub const WINDOW_ITEM_PREFIX: &str = "window:";

/// Ein `CheckMenuItem` je offenem Inhalts-Fenster, Haken beim gerade
/// fokussierten — Daten aus `windows::window_entries` (dort auch die
/// Sortier-/Titel-Begründung), hier nur noch in Tauris eigenen Item-Typ
/// übersetzt. Das ist die native macOS-„Fenster"-Menü-Konvention (jede echte
/// AppKit-App listet hier ihre offenen Fenster), die Tauris Menü-API anders
/// als natives AppKit NICHT von selbst mitbringt — ohne das hier bliebe ein
/// Fenster ohne eigenes Dock-Icon (normal, eine App hat nur eins) UND ohne
/// Menü-Eintrag komplett unauffindbar, sobald es minimiert oder auf einem
/// anderen Space liegt (2026-08-14 Nutzerbefund: nur über App-Exposé
/// wiedergefunden). Dieselbe Liste erscheint seit 2026-08-15 auch in
/// `dock.rs`s Dock-Menü — AppKit reichert ein per `applicationDockMenu:`
/// geliefertes Menü NICHT selbst um die offenen Fenster an (Annahme aus dem
/// Referenz-Editor war hier falsch, per Rechtsklick-Test widerlegt), beide
/// Stellen müssen die Liste also je selbst mitbringen.
fn window_items<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Vec<CheckMenuItem<R>>> {
    crate::windows::window_entries(app)
        .into_iter()
        .map(|(label, title, checked)| {
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

/// Ein Menüpunkt je zuletzt geöffnetem Projekt (`session_store::recent_
/// projects`, absteigend nach Aktualität) — nach demselben Live-statt-
/// gecachtem-Zustand-Muster wie `window_items` oben, nur ohne dessen Haken-
/// Zustand: ein Projekt ist nie "das gerade fokussierte" in demselben Sinn
/// wie ein Fenster. Beschriftet mit dem letzten Pfadsegment statt dem vollen
/// Pfad — der volle Pfad ginge bei einer Tiefenverschachtelung schnell über
/// die Menübreite hinaus, und die Liste ist ohnehin nach Aktualität sortiert,
/// nicht alphabetisch, ein doppelter Ordnername ist also kein Verwechslungs-
/// risiko, das eine BWK-Angabe auflösen müsste.
fn recent_project_items<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Vec<MenuItem<R>>> {
    crate::session_store::recent_projects(app)
        .into_iter()
        .map(|path| {
            let label = std::path::Path::new(&path)
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.clone());
            MenuItem::with_id(
                app,
                format!("{RECENT_PROJECT_ITEM_PREFIX}{path}"),
                label,
                true,
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
    let show_shortcuts =
        MenuItem::with_id(app, SHOW_SHORTCUTS, "Tastaturkürzel …", true, None::<&str>)?;

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

        // "Ablage"-Einträge, die die dynamische "Zuletzt geöffnete Projekte"-
        // Einfügung unten braucht (s. `ablage_items` weiter unten) — als
        // eigene Bindungen statt Inline-Referenzen im Literal wie bei den
        // übrigen Submenüs dieser Datei, weil `ablage_items` sie per `&`
        // referenzieren muss, bevor der `Menu::with_items`-Aufruf sie
        // konsumiert.
        let new_window_item = MenuItem::with_id(
            app,
            crate::dock::NEW_WINDOW_ITEM_ID,
            "Neues Fenster",
            true,
            Some("Cmd+N"),
        )?;
        let open_folder_item =
            MenuItem::with_id(app, OPEN_FOLDER, "Ordner öffnen …", true, Some("Cmd+O"))?;
        let ablage_separator = PredefinedMenuItem::separator(app)?;
        let close_window_item = MenuItem::with_id(
            app,
            CLOSE_WINDOW,
            "Schließen",
            true,
            Some("Cmd+Shift+W"),
        )?;
        let close_all_windows_item = MenuItem::with_id(
            app,
            CLOSE_ALL_WINDOWS,
            "Alle Fenster schließen",
            true,
            Some("Alt+Shift+Cmd+W"),
        )?;

        // Nur eingehängt, wenn tatsächlich etwas drin ist — ein leeres,
        // deaktiviertes "Zuletzt geöffnete Projekte" wäre reines Rauschen bei
        // jedem allerersten Start, bevor überhaupt ein Projekt geöffnet
        // wurde. `Option` statt eines leeren `Submenu`, weil ein per
        // `IsMenuItem` referenziertes leeres Untermenü unnötige Kantenfälle
        // in Tauris eigener Muda-Bindung riskiert, die window_items oben
        // (Fenster hat ja immer mindestens Minimieren/Zoomen) nie prüft.
        let recent_list = recent_project_items(app)?;
        let recent_submenu = if recent_list.is_empty() {
            None
        } else {
            let refs: Vec<&dyn IsMenuItem<R>> =
                recent_list.iter().map(|item| item as &dyn IsMenuItem<R>).collect();
            Some(Submenu::with_items(
                app,
                "Zuletzt geöffnete Projekte",
                true,
                &refs,
            )?)
        };
        let mut ablage_items: Vec<&dyn IsMenuItem<R>> = vec![&new_window_item, &open_folder_item];
        if let Some(recent_submenu) = &recent_submenu {
            ablage_items.push(recent_submenu);
        }
        ablage_items.push(&ablage_separator);
        ablage_items.push(&close_window_item);
        ablage_items.push(&close_all_windows_item);

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
                        &show_shortcuts,
                        &PredefinedMenuItem::separator(app)?,
                        &MenuItem::with_id(
                            app,
                            OPEN_SETTINGS,
                            "Einstellungen …",
                            true,
                            Some("Cmd+,"),
                        )?,
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
                // Nutzer-Vorlage 2026-08-16 (Ablage-Menü eines verbreiteten
                // macOS-Browsers als Referenz): ⌘N wirkt schon länger als
                // App-Kürzel (`NEW_WINDOW_SHORTCUT_ID`, registry.ts) —
                // dasselbe Item hier bringt es zusätzlich menübar-
                // diskutierbar und macOS-konventionell ins Menü, OHNE
                // Konflikt wie beim Schließen-Fund oben: beide Wege lösen
                // dieselbe Handlung aus (`window_open_new`), keine zwei
                // widersprüchlichen Bedeutungen für denselben Chord.
                // Dieselbe ID wie das Dock-Kontextmenü (`dock.rs`) —
                // `on_menu_event` (lib.rs) behandelt beide Quellen schon im
                // selben Match-Arm.
                &Submenu::with_items(app, "Ablage", true, &ablage_items)?,
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
        // Dieselbe Nur-wenn-nicht-leer-Bedingung wie im macOS-Zweig oben, s.
        // dessen Kommentar an `recent_list`/`recent_submenu`.
        let recent_list = recent_project_items(app)?;
        let recent_submenu = if recent_list.is_empty() {
            None
        } else {
            let refs: Vec<&dyn IsMenuItem<R>> =
                recent_list.iter().map(|item| item as &dyn IsMenuItem<R>).collect();
            Some(Submenu::with_items(
                app,
                "Zuletzt geöffnete Projekte",
                true,
                &refs,
            )?)
        };
        let open_settings_item = MenuItem::with_id(
            app,
            OPEN_SETTINGS,
            "Einstellungen …",
            true,
            Some("Ctrl+,"),
        )?;
        let open_folder_item =
            MenuItem::with_id(app, OPEN_FOLDER, "Ordner öffnen …", true, Some("Ctrl+O"))?;
        let datei_separator = PredefinedMenuItem::separator(app)?;
        let close_window_item = PredefinedMenuItem::close_window(app, Some("Schließen"))?;
        let quit_item = PredefinedMenuItem::quit(app, Some("Beenden"))?;
        let mut datei_items: Vec<&dyn IsMenuItem<R>> =
            vec![&open_settings_item, &open_folder_item];
        if let Some(recent_submenu) = &recent_submenu {
            datei_items.push(recent_submenu);
        }
        datei_items.push(&datei_separator);
        datei_items.push(&close_window_item);
        datei_items.push(&quit_item);

        // Ohne App-Menü gehört „Über" nach Windows-Konvention ins Hilfe-Menü.
        Menu::with_items(
            app,
            &[
                &Submenu::with_items(app, "Datei", true, &datei_items)?,
                &edit,
                &Submenu::with_items(
                    app,
                    "Hilfe",
                    true,
                    &[&about, &check_updates, &show_shortcuts],
                )?,
            ],
        )
    }
}
