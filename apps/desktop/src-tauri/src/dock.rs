//! Natives macOS-Rechtsklick-Menü auf dem Dock-Icon.
//!
//! Weder Tauri 2.11.5 noch dessen muda-0.19.3-Menü-Backend bieten dafür eine
//! API (gegen beide Quellen direkt geprüft: kein `dock_menu`/`set_dock_menu`
//! irgendwo). Der eigentliche Haken ist AppKits eigenes
//! `NSApplicationDelegate.applicationDockMenu:`, das tao's Delegate-Klasse
//! (`TaoAppDelegateParent`, `tao::platform_impl::macos::app_delegate`) nicht
//! implementiert. Dieses Modul fügt genau diesen Selektor der bereits
//! registrierten Klasse zur Laufzeit über `objc2`s `class_addMethod` hinzu —
//! kein Swizzling einer bestehenden Methode, der Selektor existiert dort
//! schlicht noch nicht.
//!
//! **Kein automatischer Fensterliste-Zuschuss von AppKit** (2026-08-15,
//! Rechtsklick-Test): anders als zunächst anhand des Dock-Menü-Codes des
//! Referenz-Editors (`menubar.ts`, nur ein statisches "New Window") vermutet,
//! reichert macOS ein per `applicationDockMenu:` geliefertes Menü NICHT von
//! sich aus um die offenen Fenster an — ein Test-Menü mit nur "Neues
//! Fenster" zeigte tatsächlich nur genau das. (Vermutung: der Referenz-Editor
//! baut diese Anreicherung in seiner eigenen nativen Shell-Schicht, unabhängig
//! von seinem eigenen JS-Code.) Dieses Modul liefert die Fensterliste deshalb selbst
//! mit, aus denselben Daten wie `menu.rs`s "Fenster"-Menü
//! (`windows::window_entries`) — und baut das Menü deshalb bei JEDEM
//! Rechtsklick frisch (statt einmalig statisch wie ursprünglich geplant),
//! damit ein neu geöffnetes oder geschlossenes Fenster sofort sichtbar ist.
//!
//! Das Menü selbst wird direkt über `muda::Menu` gebaut (nicht über
//! `tauri::menu`, dessen `Menu<R>` keinen rohen Plattform-Handle herausgibt —
//! `inner()` ist innerhalb von tauri selbst `pub(crate)`). Ein Klick landet
//! trotzdem im selben `on_menu_event`-Handler in `lib.rs`: Tauri registriert
//! GENAU EINEN prozessweiten `muda::MenuEvent`-Handler, unabhängig davon, zu
//! welchem `muda::Menu`-Baum das geklickte Item gehört — der Fensterliste
//! reicht deshalb dieselbe `WINDOW_ITEM_PREFIX`-Konvention wie im App-Menü,
//! `lib.rs`s bestehender Match-Arm dafür bedient beide Menüs ohne Änderung.

use std::ffi::CStr;
use std::sync::OnceLock;

use muda::{CheckMenuItem, ContextMenu, Menu, MenuItem, PredefinedMenuItem};
use objc2::ffi::class_addMethod;
use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
use objc2::sel;
use tauri::{AppHandle, Wry};

use crate::menu::WINDOW_ITEM_PREFIX;

/// Dieselbe flache Id-Konvention wie `menu::WINDOW_ITEM_PREFIX` — hier ohne
/// Präfix, weil es nur diesen einen Eintrag gibt. `lib.rs`s `on_menu_event`
/// matcht direkt darauf.
pub const NEW_WINDOW_ITEM_ID: &str = "dock-new-window";

/// Die Klasse, unter der tao seinen `NSApplicationDelegate` registriert
/// (`tao-0.35.3/src/platform_impl/macos/app_delegate.rs`). Bewusst genau
/// diese Klasse statt `NSApp.delegate()`s Laufzeit-Klasse allgemein: schlägt
/// die Suche fehl (tao benennt sie in einer künftigen Version um), bleibt das
/// unten in `install` folgenlos statt die falsche Klasse zu treffen.
const TAO_DELEGATE_CLASS: &CStr = c"TaoAppDelegateParent";

/// Einmal in `install` festgehalten, von jedem `applicationDockMenu:`-Aufruf
/// gelesen — es gibt genau einen `AppHandle` für die gesamte Prozesslaufzeit,
/// dieser Static ist nur der Weg dorthin für den rohen `extern "C"`-Callback
/// unten (der keine gewöhnlichen Rust-Parameter entgegennehmen kann). Konkret
/// auf `Wry` statt generisch über `Runtime`: die App hat ohnehin nur diese
/// eine, produktive Laufzeit (`tauri::Builder::default()`), und ein
/// `extern "C"`-Funktionszeiger kann nicht generisch sein.
static APP_HANDLE: OnceLock<AppHandle<Wry>> = OnceLock::new();

/// Hängt `applicationDockMenu:` an tao's Delegate-Klasse. Einmalig aus
/// `lib.rs`s `.setup()` aufzurufen — zu diesem Zeitpunkt hat tao sein
/// Delegate längst erzeugt und registriert (sonst könnte `.setup()` selbst
/// weiter unten gar kein "main"-Fenster mehr anlegen).
///
/// Scheitert überall weich: keine passende Dock-Menü-API, die Klasse nicht
/// gefunden, oder `class_addMethod`, das ablehnt (z. B. eine künftige
/// tao-Version, die den Selektor selbst schon definiert) — all das bedeutet
/// nur, macOS zeigt sein eigenes Standard-Dock-Kontextmenü (Optionen/
/// Ausblenden/Beenden), nie einen Absturz.
pub fn install(app: &AppHandle<Wry>) {
    let Some(class) = AnyClass::get(TAO_DELEGATE_CLASS) else {
        eprintln!("PaneCrew: Dock-Menü übersprungen — Delegate-Klasse nicht gefunden");
        return;
    };
    let _ = APP_HANDLE.set(app.clone());

    // SAFETY: `class` kommt aus `AnyClass::get` (eine lebende, registrierte
    // Klasse); `class_addMethod` ist genau dafür da, eine Methode nach der
    // Registrierung zu ergänzen (anders als `ClassBuilder`, das nur VOR
    // `register()` funktioniert). `dock_menu_imp`s Signatur
    // (`&AnyObject, Sel, *mut AnyObject) -> *mut AnyObject`) entspricht der
    // Objective-C-Signatur `- (id)applicationDockMenu:(id)sender`, die
    // `types` ("@@:@": id-Rückgabe, self, _cmd, ein id-Argument) kodiert.
    // nosemgrep: rust.lang.security.unsafe-usage.unsafe-usage -- Objective-C-Laufzeit-Methodenregistrierung auf einer bereits registrierten, per `AnyClass::get` gefundenen Klasse; Begründung im SAFETY-Kommentar direkt darüber.
    unsafe {
        class_addMethod(
            (class as *const AnyClass).cast_mut(),
            sel!(applicationDockMenu:),
            std::mem::transmute::<
                unsafe extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject) -> *mut AnyObject,
                Imp,
            >(dock_menu_imp),
            c"@@:@".as_ptr(),
        );
    }
}

/// Die eigentliche `applicationDockMenu:`-Implementierung. AppKit ruft das
/// direkt auf der Delegate-Instanz bei jedem Dock-Icon-Rechtsklick auf —
/// baut deshalb bei jedem Aufruf frisch (`build_menu`), nicht aus einem
/// zwischengespeicherten Menü: die Fensterliste darin muss den aktuellen
/// Stand zeigen. `self`/`sender` bleiben ungenutzt.
unsafe extern "C-unwind" fn dock_menu_imp(
    _this: &AnyObject,
    _sel: Sel,
    _sender: *mut AnyObject,
) -> *mut AnyObject {
    let Some(app) = APP_HANDLE.get() else {
        return std::ptr::null_mut();
    };
    let Ok(menu) = build_menu(app) else {
        return std::ptr::null_mut();
    };
    let ptr = menu.ns_menu();
    // Bewusst vergessen statt fallen gelassen: AppKit zeigt/verfolgt dieses
    // Menü direkt im Anschluss an diesen Aufruf, `Menu`s eigenes `Drop`
    // (`NsMenuRef::drop` gibt den `Retained<NSMenu>` frei) würde den nativen
    // Speicher dahinter aber SOFORT beim Rücksprung freigeben — genau der
    // Absturz, gegen den sich der Dock-Menü-Code des Referenz-Editors
    // (`menubar.ts`: "Store old menu in our array to avoid GC to collect the
    // menu and crash") mit einem Array alter Menüs absichert. Hier reicht
    // dasselbe Vergessen, ohne Wiederverwenden: ein Rechtsklick ist eine
    // seltene, manuelle Nutzerhandlung, ein winziges NSMenu pro Klick ist
    // kein Leck, das sich zu jagen lohnt.
    std::mem::forget(menu);
    ptr.cast()
}

/// Baut das Dock-Menü: "Neues Fenster" plus — nur wenn mindestens eines
/// offen ist — dieselbe Fensterliste wie `menu.rs`s "Fenster"-Menü, mit
/// derselben `WINDOW_ITEM_PREFIX`-Id-Konvention, damit `lib.rs`s
/// bestehender `on_menu_event`-Match-Arm dafür auch Klicks aus dem Dock-Menü
/// bedient.
fn build_menu(app: &AppHandle<Wry>) -> muda::Result<Menu> {
    let menu = Menu::new();
    let new_window = MenuItem::with_id(NEW_WINDOW_ITEM_ID, "Neues Fenster", true, None);
    menu.append(&new_window)?;

    let entries = crate::windows::window_entries(app);
    if !entries.is_empty() {
        menu.append(&PredefinedMenuItem::separator())?;
        for (label, title, checked) in entries {
            let item = CheckMenuItem::with_id(
                format!("{WINDOW_ITEM_PREFIX}{label}"),
                title,
                true,
                checked,
                None,
            );
            menu.append(&item)?;
        }
    }

    Ok(menu)
}
