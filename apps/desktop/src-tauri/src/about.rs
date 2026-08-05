use std::sync::Mutex;

use tauri::window::Color;
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "about";

/// Ein per Menü angeforderter Update-Check muss auf zwei Wegen ankommen, weil
/// das Fenster im Moment des Klicks entweder gerade erst entsteht oder längst
/// offen ist: im ersten Fall lauscht noch kein JavaScript, im zweiten ist der
/// Mount lange vorbei. Deshalb hier ein vorgemerkter Wunsch, den das frische
/// Fenster beim Start abholt — das bereits offene bekommt ein Ereignis.
#[derive(Default)]
pub struct PendingUpdateCheck(Mutex<bool>);

#[tauri::command]
pub fn about_take_update_request(app: AppHandle) -> bool {
    let pending = app.state::<PendingUpdateCheck>();
    let mut requested = pending.0.lock().expect("pending update check poisoned");
    std::mem::take(&mut *requested)
}

/// Singleton: ein zweiter Aufruf holt das bestehende Fenster nach vorn, statt
/// ein Duplikat zu öffnen.
pub fn show<R: Runtime>(app: &AppHandle<R>, check_updates: bool) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        if check_updates {
            let _ = window.emit("about:check-updates", ());
        }
        return;
    }

    if check_updates {
        *app.state::<PendingUpdateCheck>()
            .0
            .lock()
            .expect("pending update check poisoned") = true;
    }

    let builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("about.html".into()))
        .title("Über PaneCrew")
        .inner_size(440.0, 488.0)
        .resizable(false)
        .maximizable(false)
        .center()
        // Deckt den Weißblitz ab, den ein frisches Webview vor seinem ersten
        // Dokumentframe malt. Fest der Dark-Grundton wie beim Hauptfenster:
        // eine Theme-Umschaltung gibt es noch nicht, und der Wert lebt in der
        // nativen Fensterschicht, die keine CSS-Tokens lesen kann.
        .background_color(Color(0x12, 0x13, 0x14, 0xff));

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    if let Err(error) = builder.build() {
        eprintln!("PaneCrew: Über-Fenster konnte nicht geöffnet werden: {error}");
    }
}
