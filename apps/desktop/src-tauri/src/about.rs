use std::sync::Mutex;
use std::time::Duration;

use tauri::{
    AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindowBuilder, Window, WindowEvent,
};

const LABEL: &str = "about";
const MAIN: &str = "main";

/// Die sichtbare Silhouette wird komplett im Dokument gemalt (About.tsx,
/// dieselben Maße), das native Fenster ist nur ihr transparenter Träger. Der
/// Rand ringsum trägt den selbst gemalten Schlagschatten — dasselbe Muster wie
/// beim Splash (800x450-Bühne in einem 940x590-Fenster).
const FRAME_WIDTH: f64 = 440.0;
const FRAME_HEIGHT: f64 = 480.0;
const SHADOW_MARGIN: f64 = 56.0;

/// Letzte Rückfallebene fürs Aufdecken. Das Fenster startet unsichtbar — ein
/// frisches WKWebView malt vor seinem ersten Dokumentframe weiß, und auf einem
/// transparenten Fenster wäre das ein weißes Rechteck über der gesamten
/// Schattenfläche. Käme das Signal aus dem Frontend nie an, stünde hier ein
/// unsichtbares, aber modales Fenster: das Hauptfenster bliebe gesperrt und die
/// App sähe eingefroren aus.
const REVEAL_WATCHDOG: Duration = Duration::from_millis(1500);

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

#[tauri::command]
pub fn about_visible(app: AppHandle) {
    reveal(&app);
}

fn reveal<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
    }
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

    // Ohne native Dekoration: die angeschnittene Ecke ist die echte
    // Fensterkontur und keine Kerbe in einem Rechteck. Damit entfallen auch die
    // Ampeln — das Dokument bringt sein eigenes Schließkreuz mit.
    let builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("about.html".into()))
        .title("Über PaneCrew")
        .inner_size(
            FRAME_WIDTH + 2.0 * SHADOW_MARGIN,
            FRAME_HEIGHT + 2.0 * SHADOW_MARGIN,
        )
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .center()
        .visible(false)
        // Hebt das Fenster auf die schwebende Fensterebene, ÜBER der normalen,
        // auf der auch das Modal-Sheet des Hauptfensters liegt. Ohne das hier
        // reicht ein Wechsel in eine andere App und zurück: macOS holt dann das
        // Hauptfenster nach vorn, das Über-Fenster landet unter dessen
        // 50-%-Schleier und sieht dadurch selbst ausgegraut aus. Nachgemessen —
        // die Bühne wechselte von #121414 (deckend, korrekt) auf #1c2022, also
        // exakt den Ton des gesperrten Hauptfensters.
        //
        // Preis: das Fenster schwebt auch über anderen Apps, etwa über dem
        // Browser, den es per „GitHub-Repository" selbst öffnet. Das ist der
        // kleinere Schaden gegenüber einem Modal, das hinter seinem eigenen
        // Schleier verschwindet.
        .always_on_top(true);

    // Die Fensterebene oben macht die Arbeit, NICHT `parent()`. Das wäre der
    // naheliegende Weg, richtet auf macOS aber genau den Schaden an, den es
    // verhindern soll: `addChildWindow` hängt das Fenster in die Fenstergruppe
    // des Hauptfensters und damit unter dessen Modal-Sheet — dasselbe Ausgrauen
    // wie oben beschrieben, nur schon beim Öffnen statt erst nach einem
    // App-Wechsel (an zwei Screenshots gegeneinander nachgewiesen).
    if let Err(error) = builder.build() {
        eprintln!("PaneCrew: Über-Fenster konnte nicht geöffnet werden: {error}");
        return;
    }

    block_main(app, true);
    arm_reveal_watchdog(app);
}

/// Echte Modalität statt nachgebauter: `set_enabled(false)` hängt dem
/// Hauptfenster auf macOS ein natives, leeres Sheet an (`beginSheet:`, dieselbe
/// Lösung wie in verbreiteten App-Frameworks), unter Windows/Linux schaltet es das Fenster hart
/// ab. Solange das steht, nimmt das Hauptfenster keine Eingaben mehr an — es
/// liegt nicht bloß etwas davor.
fn block_main<R: Runtime>(app: &AppHandle<R>, blocked: bool) {
    if let Some(main) = app.get_webview_window(MAIN) {
        if let Err(error) = main.set_enabled(!blocked) {
            eprintln!("PaneCrew: Hauptfenster nicht umschaltbar: {error}");
        }
    }
}

/// Gegenstück zu `block_main`. Bewusst an `Destroyed` und nicht an
/// `CloseRequested`: ein gesperrtes Hauptfenster ist der einzige Zustand, aus
/// dem die App nicht mehr allein herausfindet, und `Destroyed` lässt sich
/// anders als eine Schließanfrage nicht abbrechen.
pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    if window.label() == LABEL && matches!(event, WindowEvent::Destroyed) {
        block_main(window.app_handle(), false);
    }
}

fn arm_reveal_watchdog<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(REVEAL_WATCHDOG);
        reveal(&app);
    });
}
