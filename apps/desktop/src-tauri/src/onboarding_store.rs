//! Onboarding completion state — `onboarding.json` in the app-data dir,
//! layered on the generic `json_store.rs` (same shape as `settings_store.rs`
//! over `settings.json`). One boolean: whether the first-run hint has been
//! satisfied. Deliberately no timestamps/step-tracking — nothing in the
//! onboarding UI needs more than "show it" vs. "don't."

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime};

const FILE_NAME: &str = "onboarding.json";

/// Broadcast to every window whenever completion changes, so a restart
/// triggered from the Settings window is reflected in the main window
/// without a poll (same pattern as `settings_commands::CHANGED_EVENT`).
const CHANGED_EVENT: &str = "onboarding:changed";

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Default)]
pub struct OnboardingState {
    pub completed: bool,
}

fn onboarding_path(dir: &std::path::Path) -> std::path::PathBuf {
    dir.join(FILE_NAME)
}

pub fn load_state(dir: &std::path::Path) -> OnboardingState {
    crate::json_store::read_json(&onboarding_path(dir), OnboardingState::default())
}

pub fn save_state(dir: &std::path::Path, state: OnboardingState) -> Result<(), String> {
    crate::json_store::write_json_atomic(&onboarding_path(dir), &state)
}

#[tauri::command(async)]
pub fn onboarding_get_state(app: AppHandle) -> Result<OnboardingState, String> {
    let dir = crate::settings_commands::app_data_dir(&app)?;
    Ok(load_state(&dir))
}

#[tauri::command(async)]
pub fn onboarding_set_completed(app: AppHandle, completed: bool) -> Result<(), String> {
    let dir = crate::settings_commands::app_data_dir(&app)?;
    let state = OnboardingState { completed };
    save_state(&dir, state)?;
    emit_changed(&app, state);
    Ok(())
}

fn emit_changed<R: Runtime>(app: &AppHandle<R>, state: OnboardingState) {
    if let Err(error) = app.emit(CHANGED_EVENT, state) {
        eprintln!("PaneCrew: onboarding:changed konnte nicht gesendet werden: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    struct Fixture(PathBuf);

    impl Fixture {
        fn new(name: &str) -> Self {
            // nosemgrep: rust.lang.security.temp-dir.temp-dir -- test fixture scratch dir, not a security operation.
            let root = std::env::temp_dir()
                .join(format!("panecrew-onboarding-store-{}-{name}", std::process::id()));
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
    fn a_missing_file_reads_as_not_completed() {
        let fixture = Fixture::new("missing");

        let state = load_state(&fixture.0);

        assert_eq!(state, OnboardingState { completed: false });
    }

    #[test]
    fn saved_completion_round_trips() {
        let fixture = Fixture::new("roundtrip");

        save_state(&fixture.0, OnboardingState { completed: true }).expect("should save");
        let state = load_state(&fixture.0);

        assert_eq!(state, OnboardingState { completed: true });
    }

    #[test]
    fn a_reset_after_completion_round_trips_back_to_not_completed() {
        let fixture = Fixture::new("reset");
        save_state(&fixture.0, OnboardingState { completed: true }).expect("should save");

        save_state(&fixture.0, OnboardingState { completed: false }).expect("should save");
        let state = load_state(&fixture.0);

        assert_eq!(state, OnboardingState { completed: false });
    }
}
