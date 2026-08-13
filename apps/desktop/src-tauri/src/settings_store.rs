//! `settings.json`-specific overlay handling, layered on the generic
//! `json_store.rs`: load the full override map, set/remove a single key,
//! writing the whole map back every time. Because a write always starts from
//! the last-read map and only touches the one key a caller asked about, a key
//! belonging to a currently-disabled extension (or any other setting nothing
//! registered *this run*) survives untouched — the map is never rebuilt from
//! the live schema, only ever read from and merged into.

use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

const FILE_NAME: &str = "settings.json";

pub type Overrides = Map<String, Value>;

fn settings_path(dir: &Path) -> PathBuf {
    dir.join(FILE_NAME)
}

/// All current overrides, or an empty map if the file is missing, unreadable,
/// or not a JSON object — a corrupt file must resolve every setting to its
/// registered default (via `ConfigRegistry::resolve`) rather than fail to
/// load, and is left untouched on disk until a deliberate write.
pub fn load_overrides(dir: &Path) -> Overrides {
    crate::json_store::read_json(&settings_path(dir), Overrides::new())
}

/// Persists a single key's override, preserving every other key already in
/// the file (including ones no longer registered).
pub fn set_override(dir: &Path, key: &str, value: Value) -> Result<(), String> {
    let mut overrides = load_overrides(dir);
    overrides.insert(key.to_string(), value);
    crate::json_store::write_json_atomic(&settings_path(dir), &overrides)
}

/// Removes a single key's override (a reset-to-default), preserving every
/// other key. Removing a key that has no override is a no-op, not an error.
pub fn remove_override(dir: &Path, key: &str) -> Result<(), String> {
    let mut overrides = load_overrides(dir);
    overrides.remove(key);
    crate::json_store::write_json_atomic(&settings_path(dir), &overrides)
}

/// Overwrites the whole overlay file at once — the raw-JSON mode's save path
/// (ticket 07). Callers validate the parsed map against the schema before
/// calling this; this function itself only performs the atomic write.
pub fn write_overrides(dir: &Path, overrides: &Overrides) -> Result<(), String> {
    crate::json_store::write_json_atomic(&settings_path(dir), overrides)
}

/// The raw text of `settings.json` for the JSON-mode editor — `"{}"` if the
/// file doesn't exist yet, so the raw view always starts from valid,
/// re-parseable JSON.
pub fn read_raw(dir: &Path) -> String {
    std::fs::read_to_string(settings_path(dir)).unwrap_or_else(|_| "{}".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    struct Fixture(PathBuf);

    impl Fixture {
        fn new(name: &str) -> Self {
            // nosemgrep: rust.lang.security.temp-dir.temp-dir -- test fixture scratch dir, not a security operation.
            let root = std::env::temp_dir().join(format!(
                "panecrew-settings-store-{}-{name}",
                std::process::id()
            ));
            std::fs::remove_dir_all(&root).ok();
            std::fs::create_dir_all(&root).expect("test fixture root should be creatable");
            Self(root)
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.0).ok();
        }
    }

    #[test]
    fn setting_a_value_persists_it_and_the_next_load_reflects_it() {
        let fixture = Fixture::new("set");

        set_override(
            &fixture.0,
            "terminal.shell",
            Value::String("/bin/fish".into()),
        )
        .expect("should write");
        let overrides = load_overrides(&fixture.0);

        assert_eq!(
            overrides.get("terminal.shell"),
            Some(&Value::String("/bin/fish".into()))
        );
    }

    #[test]
    fn resetting_a_value_removes_the_override() {
        let fixture = Fixture::new("reset");
        set_override(
            &fixture.0,
            "terminal.shell",
            Value::String("/bin/fish".into()),
        )
        .expect("should write");

        remove_override(&fixture.0, "terminal.shell").expect("should write");
        let overrides = load_overrides(&fixture.0);

        assert!(!overrides.contains_key("terminal.shell"));
    }

    #[test]
    fn an_unknown_key_already_present_survives_a_write_untouched() {
        let fixture = Fixture::new("unknown-key-survives");
        set_override(
            &fixture.0,
            "some-disabled-extension.retryCount",
            Value::from(5),
        )
        .expect("should write");

        set_override(
            &fixture.0,
            "terminal.shell",
            Value::String("/bin/zsh".into()),
        )
        .expect("should write");
        let overrides = load_overrides(&fixture.0);

        assert_eq!(
            overrides.get("some-disabled-extension.retryCount"),
            Some(&Value::from(5))
        );
        assert_eq!(
            overrides.get("terminal.shell"),
            Some(&Value::String("/bin/zsh".into()))
        );
    }

    #[test]
    fn settings_json_after_a_write_contains_overrides_only_never_a_default_dump() {
        let fixture = Fixture::new("overrides-only");

        set_override(
            &fixture.0,
            "terminal.shell",
            Value::String("/bin/fish".into()),
        )
        .expect("should write");
        let raw = std::fs::read_to_string(settings_path(&fixture.0)).expect("file should exist");
        let parsed: Overrides = serde_json::from_str(&raw).expect("should be valid JSON");

        assert_eq!(parsed.len(), 1);
        assert!(parsed.contains_key("terminal.shell"));
    }

    #[test]
    fn a_corrupt_settings_file_loads_as_empty_overrides_and_is_left_untouched() {
        let fixture = Fixture::new("corrupt");
        std::fs::write(settings_path(&fixture.0), b"not json").expect("fixture write");

        let overrides = load_overrides(&fixture.0);

        assert!(overrides.is_empty());
        assert_eq!(
            std::fs::read(settings_path(&fixture.0)).expect("file should still be there"),
            b"not json"
        );
    }

    #[test]
    fn read_raw_returns_an_empty_object_when_the_file_does_not_exist_yet() {
        let fixture = Fixture::new("raw-missing");

        assert_eq!(read_raw(&fixture.0), "{}");
    }

    #[test]
    fn read_raw_returns_the_exact_file_contents_when_present() {
        let fixture = Fixture::new("raw-present");
        set_override(
            &fixture.0,
            "terminal.shell",
            Value::String("/bin/fish".into()),
        )
        .expect("should write");

        let raw = read_raw(&fixture.0);
        let parsed: Overrides = serde_json::from_str(&raw).expect("should be valid JSON");
        assert_eq!(
            parsed.get("terminal.shell"),
            Some(&Value::String("/bin/fish".into()))
        );
    }
}
