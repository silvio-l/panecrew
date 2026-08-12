//! Whole-session persistence (Ticket 06): grid template, slot→project
//! assignments and each slot's last-opened explorer file, written to
//! `session.json` in the app-data dir. The PTY process itself is never
//! persisted — restoring a slot only respawns a fresh shell in the right
//! `cwd` (the frontend's job), this module only round-trips the JSON.
//!
//! `read_session` also validates every `project_path` against the real
//! filesystem: a folder that no longer exists must fall back to an empty
//! slot silently (CLAUDE.md, ticket 06) rather than surfacing an error or
//! failing the whole restore.

use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

const FILE_NAME: &str = "session.json";

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct PersistedSlot {
    pub project_path: String,
    /// Project-relative path of the file selected/open in this slot's
    /// explorer — the same string `App.tsx`'s `selectedFile` map already
    /// holds per pane. `None` when nothing was open.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_selected_file: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, PartialEq, Eq, Default)]
pub struct SessionState {
    pub template: String,
    pub slots: Vec<Option<PersistedSlot>>,
    /// Which folders the user has *expanded* in the explorer tree, keyed by
    /// absolute project path rather than by slot: the live explorer state is
    /// itself bound to `project.path` (`ExplorerPanel` remounts on that key,
    /// not on a pane/slot id — the same project open in two panes shares one
    /// live tree). Keying this per-slot instead would silently drop one of the
    /// two states whenever that happened. Absent entry means "nothing expanded
    /// yet for this project" — the frontend then falls back to its own
    /// all-collapsed default.
    ///
    /// Deliberately the expanded set, not the collapsed one (2026-08-12): the
    /// frontend default became "everything collapsed" earlier the same day,
    /// which made the collapsed set equal to *every folder in the project* —
    /// measured at 135 KB and ~1900 paths for four open projects, rewritten in
    /// full on every selection change. Storing the deviation from the default
    /// instead keeps this a handful of paths. The field was renamed rather
    /// than reinterpreted in place, because reading an existing file's old
    /// `collapsed_folders` list as this one would silently restore "everything
    /// expanded" — precisely the behaviour that was just removed. An old file
    /// simply has no entry here and starts at the default.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub expanded_folders: HashMap<String, Vec<String>>,
}

fn session_path(dir: &Path) -> PathBuf {
    dir.join(FILE_NAME)
}

/// Reads the persisted session, or `None` if there is none yet, the file is
/// unreadable, or it fails to parse — a corrupt or foreign file must not
/// fail app startup (same "survivable, not fatal" stance as `launch.rs`),
/// it just means starting at the picker exactly as on first launch.
pub fn read_session(dir: &Path) -> Option<SessionState> {
    let bytes = std::fs::read(session_path(dir)).ok()?;
    let mut state: SessionState = serde_json::from_slice(&bytes).ok()?;
    for slot in &mut state.slots {
        if let Some(persisted) = slot {
            if !Path::new(&persisted.project_path).is_dir() {
                *slot = None;
            }
        }
    }
    // Prune entries for projects no longer occupying any surviving slot —
    // otherwise a closed pane's expand state accumulates in the file forever,
    // growing it for no restorable benefit.
    let live_paths: std::collections::HashSet<&str> = state
        .slots
        .iter()
        .flatten()
        .map(|slot| slot.project_path.as_str())
        .collect();
    state
        .expanded_folders
        .retain(|project_path, _| live_paths.contains(project_path.as_str()));
    Some(state)
}

/// Same temp-file-then-atomic-rename pattern as
/// `explorer_fs::explorer_write_file`: a crash between writing and renaming
/// leaves either the previous session or the new one intact on disk, never a
/// half-written file that fails to parse on the next launch.
pub fn write_session(dir: &Path, state: &SessionState) -> Result<(), String> {
    std::fs::create_dir_all(dir)
        .map_err(|error| format!("Anwendungsverzeichnis konnte nicht angelegt werden: {error}"))?;
    let path = session_path(dir);
    let json = serde_json::to_vec_pretty(state)
        .map_err(|error| format!("Sitzung konnte nicht serialisiert werden: {error}"))?;

    let temp_path = dir.join(format!(".{FILE_NAME}.panecrew-tmp-{}", std::process::id()));
    let write_result = (|| -> std::io::Result<()> {
        let mut file = std::fs::File::create(&temp_path)?;
        file.write_all(&json)?;
        file.sync_all()
    })();
    if let Err(error) = write_result {
        std::fs::remove_file(&temp_path).ok();
        return Err(format!("Sitzung konnte nicht geschrieben werden: {error}"));
    }
    std::fs::rename(&temp_path, &path)
        .map_err(|error| format!("Sitzung konnte nicht gespeichert werden: {error}"))
}

// `async`: file I/O must not run on the thread that dispatches IPC (see
// `explorer_fs.rs::explorer_read_tree` for the source-verified reasoning).
// `session_save` in particular fires on every grid/selection change once
// hydrated — a hot path, not just a one-off startup read.
#[tauri::command(async)]
pub fn session_load(app: AppHandle) -> Option<SessionState> {
    let dir = app.path().app_data_dir().ok()?;
    read_session(&dir)
}

#[tauri::command(async)]
pub fn session_save(app: AppHandle, state: SessionState) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Anwendungsverzeichnis nicht verfügbar: {error}"))?;
    write_session(&dir, &state)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A throwaway app-data dir under the system temp dir, removed by
    /// `drop` — same shape as `explorer_fs.rs`'s own `Fixture`.
    struct Fixture(PathBuf);

    impl Fixture {
        fn new(name: &str) -> Self {
            let root = std::env::temp_dir()
                .join(format!("panecrew-session-store-{}-{name}", std::process::id()));
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

    fn slot(project_path: &str, last_selected_file: Option<&str>) -> Option<PersistedSlot> {
        Some(PersistedSlot {
            project_path: project_path.to_string(),
            last_selected_file: last_selected_file.map(str::to_string),
        })
    }

    #[test]
    fn a_missing_session_file_reads_as_none() {
        let fixture = Fixture::new("missing");

        assert_eq!(read_session(&fixture.0), None);
    }

    #[test]
    fn a_corrupt_session_file_reads_as_none_instead_of_failing() {
        let fixture = Fixture::new("corrupt");
        std::fs::write(session_path(&fixture.0), b"not json").expect("fixture write");

        assert_eq!(read_session(&fixture.0), None);
    }

    #[test]
    fn round_trips_the_full_state_through_write_and_read() {
        let fixture = Fixture::new("roundtrip");
        // The two project paths must actually exist on disk — `read_session`
        // validates every slot against the real filesystem.
        let project_a = fixture.0.join("project-a");
        let project_b = fixture.0.join("project-b");
        std::fs::create_dir_all(&project_a).expect("fixture dir");
        std::fs::create_dir_all(&project_b).expect("fixture dir");
        let state = SessionState {
            template: "split".to_string(),
            slots: vec![
                slot(&project_a.to_string_lossy(), Some("src/App.tsx")),
                slot(&project_b.to_string_lossy(), None),
            ],
            expanded_folders: HashMap::from([(
                project_a.to_string_lossy().into_owned(),
                vec!["src".to_string(), "src/core".to_string()],
            )]),
        };

        write_session(&fixture.0, &state).expect("should write");
        let read_back = read_session(&fixture.0).expect("should read back");

        assert_eq!(read_back, state);
    }

    #[test]
    fn prunes_expanded_folder_entries_for_projects_no_longer_in_any_slot() {
        let fixture = Fixture::new("prune-expanded");
        let project = fixture.0.join("kept-project");
        std::fs::create_dir_all(&project).expect("fixture dir");
        let kept_path = project.to_string_lossy().into_owned();
        let state = SessionState {
            template: "single".to_string(),
            slots: vec![slot(&kept_path, None)],
            expanded_folders: HashMap::from([
                (kept_path.clone(), vec!["src".to_string()]),
                ("/no/longer/open".to_string(), vec!["old".to_string()]),
            ]),
        };
        write_session(&fixture.0, &state).expect("should write");

        let read_back = read_session(&fixture.0).expect("should read back");

        assert_eq!(
            read_back.expanded_folders,
            HashMap::from([(kept_path, vec!["src".to_string()])]),
        );
    }

    /// The pre-2026-08-12 field held the *collapsed* folders — the exact
    /// inverse. Reading it into `expanded_folders` would restore "everything
    /// expanded" for every project the user had ever opened, silently undoing
    /// the all-collapsed default. It must be ignored outright, leaving the
    /// project at that default, and must not fail the parse either (an
    /// unreadable session would drop the user back at the picker).
    #[test]
    fn ignores_the_old_inverted_collapsed_folders_field_instead_of_reusing_it() {
        let fixture = Fixture::new("legacy-collapsed");
        let project = fixture.0.join("legacy-project");
        std::fs::create_dir_all(&project).expect("fixture dir");
        let project_path = project.to_string_lossy().into_owned();
        // Written as raw JSON on purpose: the old shape no longer has a Rust
        // type here to serialize from — that is the whole point of the rename.
        let escaped = project_path.replace('\\', "\\\\");
        std::fs::write(
            session_path(&fixture.0),
            format!(
                r#"{{"template":"single","slots":[{{"project_path":"{escaped}"}}],"collapsed_folders":{{"{escaped}":["src","src/core"]}}}}"#
            ),
        )
        .expect("fixture write");

        let read_back = read_session(&fixture.0).expect("should still parse");

        assert_eq!(read_back.slots, vec![slot(&project_path, None)]);
        assert!(read_back.expanded_folders.is_empty());
    }

    #[test]
    fn drops_a_slot_whose_project_folder_no_longer_exists_instead_of_erroring() {
        let fixture = Fixture::new("missing-folder");
        let gone = fixture.0.join("gone-project").to_string_lossy().into_owned();
        let state = SessionState {
            template: "quad".to_string(),
            slots: vec![slot(&gone, Some("README.md")), None],
            expanded_folders: HashMap::new(),
        };
        write_session(&fixture.0, &state).expect("should write");

        let read_back = read_session(&fixture.0).expect("file itself is valid JSON");

        assert_eq!(read_back.slots, vec![None, None]);
    }

    #[test]
    fn a_second_write_overwrites_the_first_rather_than_appending() {
        let fixture = Fixture::new("overwrite");
        let project = fixture.0.join("only-project");
        std::fs::create_dir_all(&project).expect("fixture dir");
        let path_string = project.to_string_lossy().into_owned();
        write_session(
            &fixture.0,
            &SessionState {
                template: "single".to_string(),
                slots: vec![slot(&path_string, None)],
                expanded_folders: HashMap::new(),
            },
        )
        .expect("first write");

        write_session(
            &fixture.0,
            &SessionState {
                template: "quad".to_string(),
                slots: vec![None, None, None, None],
                expanded_folders: HashMap::new(),
            },
        )
        .expect("second write");

        let read_back = read_session(&fixture.0).expect("should read back");
        assert_eq!(read_back.template, "quad");
        assert_eq!(read_back.slots, vec![None, None, None, None]);
    }

    #[test]
    fn leaves_no_temp_file_behind_after_a_successful_write() {
        let fixture = Fixture::new("write-no-litter");

        write_session(
            &fixture.0,
            &SessionState {
                template: "quad".to_string(),
                slots: vec![None, None, None, None],
                expanded_folders: HashMap::new(),
            },
        )
        .expect("should write");

        let leftovers: Vec<_> = std::fs::read_dir(&fixture.0)
            .expect("fixture dir readable")
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().contains("panecrew-tmp"))
            .collect();
        assert!(leftovers.is_empty());
    }

    #[test]
    fn creates_the_app_data_dir_if_it_does_not_exist_yet() {
        let fixture = Fixture::new("create-dir");
        let nested = fixture.0.join("nested").join("app-data");

        write_session(
            &nested,
            &SessionState {
                template: "quad".to_string(),
                slots: vec![None, None, None, None],
                expanded_folders: HashMap::new(),
            },
        )
        .expect("should create the directory and write");

        assert!(nested.is_dir());
        assert!(session_path(&nested).is_file());
    }
}
