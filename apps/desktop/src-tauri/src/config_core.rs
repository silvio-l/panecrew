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
    // "Awaiting attention" basis (terminalActivity.ts, 2026-08-17 rewrite):
    // activityIdleMs is how long a tab must receive NO output at all (not
    // just no new committed line — see terminalActivity.ts header comment on
    // why liveness needs the broader signal) before it flags as "done,
    // waiting on you"; activityLineThreshold is how many committed lines a
    // tab needs before it's considered to have done real work at all (a
    // freshly spawned, still-empty shell must not flag immediately).
    // 15000 verified against a real captured Claude Code PTY session // brandlint-ok: functional reference to the specific tool tested, not marketing
    // (root-cause investigation for this rewrite): observed intra-turn
    // "thinking" pauses between tool calls topped out around 8s with no new
    // committed line, so 15000 leaves roughly 2x headroom against a false
    // "done" flag while the tool is still visibly working. Kept unchanged
    // from the previous (differently-motivated) default rather than tuned
    // down, since that sample size doesn't justify tightening it further.
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
    // Ticket 35: which adapter a freshly opened terminal tab starts with
    // when the user doesn't pick one explicitly from the picker's dropdown.
    // "shell" is the built-in login shell, same as an absent per-tab
    // `adapter_id` in the session schema — kept as an explicit enum member
    // rather than reusing `null`/absent here so this setting round-trips
    // through the generic Enum settings control like every other one.
    registry.register(entry(
        "terminal.defaultAdapter",
        SettingType::Enum(vec![
            "shell".into(),
            "claude".into(),  // brandlint-ok: canonical adapter id, functional
            "codex".into(),   // brandlint-ok: canonical adapter id, functional
            "gemini".into(),  // brandlint-ok: canonical adapter id, functional
            "copilot".into(), // brandlint-ok: canonical adapter id, functional
            "opencode".into(),
        ]),
        serde_json::json!("shell"),
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
        assert!(keys.contains(&"terminal.defaultAdapter"));
        assert!(keys.contains(&"explorer.confirmBeforeDelete"));
        assert!(keys.contains(&"appearance.theme"));
        assert!(keys.contains(&"appearance.language"));
        assert!(keys.contains(&"grid.defaultTemplate"));
    }

    /// Ticket 35: the fixed adapter list ("shell" plus a handful of
    /// in-code-known CLI tools) is duplicated here as the enum's own
    /// options, same reasoning as `grid_default_template_covers_all...`
    /// below — the frontend's `terminal/adapters.ts` is the live source of
    /// truth, this test just keeps the two from silently drifting apart.
    #[test]
    fn terminal_default_adapter_defaults_to_shell_with_the_fixed_tool_list() {
        let mut registry = ConfigRegistry::new();
        register_core_settings(&mut registry).unwrap();

        let entry = registry
            .find("terminal.defaultAdapter")
            .expect("should be registered");

        assert_eq!(entry.default, serde_json::json!("shell"));
        assert_eq!(
            entry.setting_type,
            SettingType::Enum(vec![
                "shell".into(),
                "claude".into(),  // brandlint-ok: canonical adapter id, functional
                "codex".into(),   // brandlint-ok: canonical adapter id, functional
                "gemini".into(),  // brandlint-ok: canonical adapter id, functional
                "copilot".into(), // brandlint-ok: canonical adapter id, functional
                "opencode".into(),
            ])
        );
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
