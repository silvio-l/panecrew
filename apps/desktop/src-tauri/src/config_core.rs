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
        serde_json::json!(13),
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
        serde_json::json!("system"),
    ))?;
    registry.register(entry(
        "appearance.language",
        SettingType::Enum(vec!["de".into(), "en".into()]),
        serde_json::json!("de"),
    ))?;

    // Grid
    registry.register(entry(
        "grid.defaultTemplate",
        SettingType::Enum(vec!["single".into(), "split".into(), "quad".into()]),
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
        assert!(keys.contains(&"explorer.confirmBeforeDelete"));
        assert!(keys.contains(&"appearance.theme"));
        assert!(keys.contains(&"appearance.language"));
        assert!(keys.contains(&"grid.defaultTemplate"));
    }

    #[test]
    fn appearance_language_defaults_to_de_with_the_two_supported_options() {
        let mut registry = ConfigRegistry::new();
        register_core_settings(&mut registry).unwrap();

        let entry = registry
            .find("appearance.language")
            .expect("should be registered");

        assert_eq!(entry.default, serde_json::json!("de"));
        assert_eq!(
            entry.setting_type,
            SettingType::Enum(vec!["de".into(), "en".into()])
        );
    }

    #[test]
    fn appearance_theme_defaults_to_system_with_the_three_documented_options() {
        let mut registry = ConfigRegistry::new();
        register_core_settings(&mut registry).unwrap();

        let entry = registry
            .find("appearance.theme")
            .expect("should be registered");

        assert_eq!(entry.default, serde_json::json!("system"));
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
}
