//! The settings editor's own window — modelled on `about.rs`'s singleton
//! open/raise pattern, but deliberately NOT `about.rs`'s modal/`always_on_top`
//! behaviour: this is a normal, focusable, resizable sibling window that
//! never blocks or dims the main window (story 9 of the spec).

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "settings";

/// Singleton: a second call brings the existing window to the front instead
/// of opening a duplicate (story 10).
pub fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    let title = if app.config().identifier.ends_with(".nightly") {
        "PaneCrew Nightly — Einstellungen"
    } else {
        "PaneCrew — Einstellungen"
    };

    let builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("settings.html".into()))
        .title(title)
        .inner_size(760.0, 560.0)
        .min_inner_size(560.0, 420.0)
        // Normal native decorations, normal resizing, no `always_on_top`: the
        // opposite of `about.rs` on every point that made that window modal.
        .resizable(true)
        .center();

    if let Err(error) = builder.build() {
        eprintln!("PaneCrew: Einstellungen-Fenster konnte nicht geöffnet werden: {error}");
    }
}
