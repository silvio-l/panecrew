//! Core settings as a built-in "core extension": registers the
//! Terminal/Explorer/Appearance/Grid schema entries through
//! `ConfigRegistry::register`, the exact same call an extension's manifest
//! parsing (`config_manifest.rs`) uses — there is no private registration
//! path for core settings.
//!
//! `description` on every entry is an i18n key, not a literal string: the
//! registry never renders text, and `apps/desktop/src/i18n/locales/{de,en}.json`
//! carry the resolved copy under the matching key so `useSettings.ts`
//! (ticket 03) can hand it straight to `t()`.

use crate::config_registry::{
    ConfigRegistry, Description, RegistrationError, SchemaEntry, SettingType, Source,
};

fn entry(key: &str, setting_type: SettingType, default: serde_json::Value) -> SchemaEntry {
    SchemaEntry {
        key: key.to_string(),
        setting_type,
        default,
        description: Description::I18nKey(format!("settings.schema.{key}.description")),
        source: Source::Core,
    }
}

/// Registers every core setting. Called once at app startup (`lib.rs`) before
/// the registry is handed to Tauri as managed state, and directly in tests
/// against a fresh `ConfigRegistry`.
pub fn register_core_settings(registry: &mut ConfigRegistry) -> Result<(), RegistrationError> {
    // Terminal
    registry.register(entry(
        "terminal.shell",
        SettingType::String,
        serde_json::json!(crate::pty_manager::default_shell()),
    ))?;
    registry.register(entry(
        "terminal.fontSize",
        SettingType::Number,
        serde_json::json!(14),
    ))?;
    // Needs-Attention-Grundlage (terminalActivity.ts, Task #7/#13): ein Tab
    // gilt intern als "aktiv", sobald innerhalb von activityIdleMs mindestens
    // activityLineThreshold neue Zeilen committet wurden — das steuert aber
    // seit dem Ungelesen-Umbau (terminalActivity.ts, Nutzer-Neuspezifikation
    // 2026-08-13) KEIN sichtbares Aktiv/Inaktiv mehr, sondern nur noch, wie
    // empfindlich der PERSISTENTE Ungelesen-Punkt anschlägt (der bleibt dann
    // bestehen, bis der Tab angesehen wird, unabhängig von activityIdleMs).
    // Default 15000 (statt vormals 1500) trägt dieser neuen, nicht mehr
    // selbstheilenden Semantik Rechnung — ein zu kurzes Fenster markierte bei
    // jedem harmlosen Gelegenheits-Log-Zeilchen sofort "ungelesen" (Fund
    // 2026-08-13, Nutzer-Bugreport: mehrere echte Hintergrund-Agenten lösten
    // den Punkt korrekt, aber zu leichtfertig aus).
    registry.register(entry(
        "terminal.activityIdleMs",
        SettingType::Number,
        serde_json::json!(15000),
    ))?;
    registry.register(entry(
        "terminal.activityLineThreshold",
        SettingType::Number,
        serde_json::json!(1),
    ))?;

    // Explorer
    registry.register(entry(
        "explorer.confirmBeforeDelete",
        SettingType::Boolean,
        serde_json::json!(true),
    ))?;

    // Appearance
    registry.register(entry(
        "appearance.theme",
        SettingType::Enum(vec!["system".into(), "light".into(), "dark".into()]),
        serde_json::json!("dark"),
    ))?;
    registry.register(entry(
        "appearance.language",
        SettingType::Enum(vec!["de".into(), "en".into()]),
        serde_json::json!("en"),
    ))?;
    // UI-Zoom (Shift+Cmd/Strg +/-/0, `useAppZoom.ts`) — bislang reiner
    // Laufzeit-State ohne jede Persistenz, jeder Neustart fiel auf 1 zurück.
    // Bewusst von `terminal.fontSize` getrennt: Zoom skaliert die ganze
    // Oberfläche über den nativen Webview-Zoom, die Terminal-Schriftgröße nur
    // den Zellraster-Text in den Panes.
    //
    // Default 1.2 statt der neutralen 1.0, passend zu `DEFAULT_APP_ZOOM` in
    // `shortcuts/zoom.ts` (2026-08-14, Nutzerentscheidung: native Stufe war
    // auf den getesteten Monitoren spürbar zu klein) — beide Defaults müssen
    // synchron bleiben, sonst zeigt ein frischer Start kurz 100% Chrome-Zoom,
    // bevor `useAppZoom.ts`s eigener Default greift.
    registry.register(entry(
        "appearance.zoom",
        SettingType::Number,
        serde_json::json!(1.2),
    ))?;

    // Grid — dieselben sieben Werte wie `TemplateId` in gridState.ts
    // (Frontend-seitige Quelle der Wahrheit); ein Test unten hält beide
    // Listen in Sync.
    registry.register(entry(
        "grid.defaultTemplate",
        SettingType::Enum(vec![
            "single".into(),
            "split".into(),
            "two-over-one".into(),
            "one-over-two".into(),
            "row-3".into(),
            "quad".into(),
            "row-4".into(),
        ]),
        serde_json::json!("quad"),
    ))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registers_terminal_explorer_appearance_and_grid_categories() {
        let mut registry = ConfigRegistry::new();

        register_core_settings(&mut registry).expect("core settings should register cleanly");

        let keys: Vec<&str> = registry
            .schema()
            .iter()
            .map(|entry| entry.key.as_str())
            .collect();
        assert!(keys.contains(&"terminal.shell"));
        assert!(keys.contains(&"terminal.fontSize"));
        assert!(keys.contains(&"terminal.activityIdleMs"));
        assert!(keys.contains(&"terminal.activityLineThreshold"));
        assert!(keys.contains(&"explorer.confirmBeforeDelete"));
        assert!(keys.contains(&"appearance.theme"));
        assert!(keys.contains(&"appearance.language"));
        assert!(keys.contains(&"grid.defaultTemplate"));
    }

    #[test]
    fn appearance_language_defaults_to_en_with_the_two_supported_options() {
        let mut registry = ConfigRegistry::new();
        register_core_settings(&mut registry).unwrap();

        let entry = registry
            .find("appearance.language")
            .expect("should be registered");

        assert_eq!(entry.default, serde_json::json!("en"));
        assert_eq!(
            entry.setting_type,
            SettingType::Enum(vec!["de".into(), "en".into()])
        );
    }

    #[test]
    fn appearance_zoom_defaults_to_1_2_and_is_a_plain_number() {
        let mut registry = ConfigRegistry::new();
        register_core_settings(&mut registry).unwrap();

        let entry = registry
            .find("appearance.zoom")
            .expect("should be registered");

        assert_eq!(entry.default, serde_json::json!(1.2));
        assert_eq!(entry.setting_type, SettingType::Number);
    }

    #[test]
    fn appearance_theme_defaults_to_dark_with_the_three_documented_options() {
        let mut registry = ConfigRegistry::new();
        register_core_settings(&mut registry).unwrap();

        let entry = registry
            .find("appearance.theme")
            .expect("should be registered");

        assert_eq!(entry.default, serde_json::json!("dark"));
        assert_eq!(
            entry.setting_type,
            SettingType::Enum(vec!["system".into(), "light".into(), "dark".into()])
        );
    }

    #[test]
    fn grid_default_template_defaults_to_quad_matching_gridstate_ts() {
        let mut registry = ConfigRegistry::new();
        register_core_settings(&mut registry).unwrap();

        let entry = registry
            .find("grid.defaultTemplate")
            .expect("should be registered");

        assert_eq!(entry.default, serde_json::json!("quad"));
    }

    #[test]
    fn grid_default_template_covers_all_seven_templateid_values() {
        // Muss exakt der `TemplateId`-Union in gridState.ts entsprechen — sonst
        // kann diese Einstellung Layouts wählen, die der Hauptfenster-Switcher
        // gar nicht anbietet (oder umgekehrt). Bewusst als eigener Test von
        // `grid_default_template_defaults_to_quad_matching_gridstate_ts`
        // getrennt: der eine prüft den Default, dieser die Vollständigkeit.
        let mut registry = ConfigRegistry::new();
        register_core_settings(&mut registry).unwrap();

        let entry = registry
            .find("grid.defaultTemplate")
            .expect("should be registered");

        assert_eq!(
            entry.setting_type,
            SettingType::Enum(vec![
                "single".into(),
                "split".into(),
                "two-over-one".into(),
                "one-over-two".into(),
                "row-3".into(),
                "quad".into(),
                "row-4".into(),
            ])
        );
    }
}
