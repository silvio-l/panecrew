//! Generic atomic JSON document I/O for files in Tauri's `app_data_dir()`.
//!
//! `session_store.rs` already hand-rolled this exact temp-file-then-rename
//! sequence for `session.json` before this module existed; this is the
//! generic version other on-disk documents (starting with `settings.json` in
//! `settings_store.rs`) build on instead of a third copy of the same idiom.
//! `session_store.rs` itself is left as-is — reshaping working, tested code
//! onto a generic module it didn't ask for is out of scope here.
//!
//! Pure `serde`/`std::fs`, no `AppHandle` coupling: directly testable against
//! a temp dir, in the same spirit as `path_probe.rs`/`explorer_fs.rs`.

use std::io::Write;
use std::path::Path;

use serde::de::DeserializeOwned;
use serde::Serialize;

/// Reads the JSON document at `path`, or `default` if the file is missing,
/// unreadable, or fails to parse. A corrupt file is never touched by a
/// read — recovering to defaults must not cost the user their last-good file
/// on disk, only the ability to read it back until it's fixed or overwritten
/// by a deliberate write.
pub fn read_json<T: DeserializeOwned>(path: &Path, default: T) -> T {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or(default)
}

/// Writes `value` to `path` atomically: serialize, write to a sibling temp
/// file, `sync_all()`, then `rename()` over the real path. A crash at any
/// point before the rename leaves the previous file (or no file) exactly as
/// it was — never a half-written target — because `rename` within the same
/// directory is the atomic step, not the write itself. Same sequencing as
/// `explorer_fs::explorer_write_file` and `session_store::write_session`.
pub fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Zielpfad hat kein Elternverzeichnis".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("Verzeichnis konnte nicht angelegt werden: {error}"))?;

    let json = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("Dokument konnte nicht serialisiert werden: {error}"))?;

    let file_name = path
        .file_name()
        .ok_or_else(|| "Zielpfad hat keinen Dateinamen".to_string())?
        .to_string_lossy();
    let temp_path = parent.join(format!(".{file_name}.panecrew-tmp-{}", std::process::id()));

    let write_result = (|| -> std::io::Result<()> {
        let mut file = std::fs::File::create(&temp_path)?;
        file.write_all(&json)?;
        file.sync_all()
    })();
    if let Err(error) = write_result {
        std::fs::remove_file(&temp_path).ok();
        return Err(format!("Dokument konnte nicht geschrieben werden: {error}"));
    }

    std::fs::rename(&temp_path, path)
        .map_err(|error| format!("Dokument konnte nicht gespeichert werden: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[derive(serde::Serialize, serde::Deserialize, Debug, Clone, PartialEq, Default)]
    struct Doc {
        value: String,
        count: u32,
    }

    /// A throwaway app-data dir under the system temp dir, removed by
    /// `drop` — same shape as `explorer_fs.rs`'s/`session_store.rs`'s own
    /// `Fixture`.
    struct Fixture(PathBuf);

    impl Fixture {
        fn new(name: &str) -> Self {
            // nosemgrep: rust.lang.security.temp-dir.temp-dir -- test fixture scratch dir, not a security operation.
            let root = std::env::temp_dir()
                .join(format!("panecrew-json-store-{}-{name}", std::process::id()));
            std::fs::remove_dir_all(&root).ok();
            std::fs::create_dir_all(&root).expect("test fixture root should be creatable");
            Self(root)
        }

        fn path(&self, file_name: &str) -> PathBuf {
            self.0.join(file_name)
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.0).ok();
        }
    }

    #[test]
    fn a_missing_file_reads_as_the_caller_supplied_default_without_creating_it() {
        let fixture = Fixture::new("missing");
        let path = fixture.path("doc.json");

        let read = read_json(&path, Doc::default());

        assert_eq!(read, Doc::default());
        assert!(!path.exists());
    }

    #[test]
    fn a_corrupt_file_reads_as_the_default_and_is_left_untouched_on_disk() {
        let fixture = Fixture::new("corrupt");
        let path = fixture.path("doc.json");
        std::fs::write(&path, b"not json").expect("fixture write");

        let read = read_json(&path, Doc::default());

        assert_eq!(read, Doc::default());
        assert_eq!(
            std::fs::read(&path).expect("file should still be there"),
            b"not json"
        );
    }

    #[test]
    fn write_then_read_round_trips_the_exact_content() {
        let fixture = Fixture::new("roundtrip");
        let path = fixture.path("doc.json");
        let doc = Doc {
            value: "amber".to_string(),
            count: 3,
        };

        write_json_atomic(&path, &doc).expect("should write");
        let read = read_json(&path, Doc::default());

        assert_eq!(read, doc);
    }

    #[test]
    fn a_second_write_overwrites_the_first_rather_than_appending() {
        let fixture = Fixture::new("overwrite");
        let path = fixture.path("doc.json");

        write_json_atomic(
            &path,
            &Doc {
                value: "first".to_string(),
                count: 1,
            },
        )
        .expect("first write");
        write_json_atomic(
            &path,
            &Doc {
                value: "second".to_string(),
                count: 2,
            },
        )
        .expect("second write");

        let read = read_json(&path, Doc::default());
        assert_eq!(
            read,
            Doc {
                value: "second".to_string(),
                count: 2,
            }
        );
    }

    #[test]
    fn leaves_no_temp_file_behind_after_a_successful_write() {
        let fixture = Fixture::new("write-no-litter");
        let path = fixture.path("doc.json");

        write_json_atomic(&path, &Doc::default()).expect("should write");

        let leftovers: Vec<_> = std::fs::read_dir(&fixture.0)
            .expect("fixture dir readable")
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().contains("panecrew-tmp"))
            .collect();
        assert!(leftovers.is_empty());
    }

    #[test]
    fn creates_the_parent_directory_if_it_does_not_exist_yet() {
        let fixture = Fixture::new("create-dir");
        let path = fixture.0.join("nested").join("doc.json");

        write_json_atomic(&path, &Doc::default()).expect("should create the directory and write");

        assert!(path.is_file());
    }

    /// The target file must never be observable in a half-written state.
    /// A "crash between temp-write and rename" is exactly the state a stray,
    /// incomplete temp file (never renamed) represents — this proves that
    /// state has zero effect on what a read of the real path sees, which is
    /// the atomicity guarantee the temp-file-then-rename sequence exists for.
    #[test]
    fn an_incomplete_temp_file_never_left_a_previous_write_or_a_missing_file_visible_as_corrupted()
    {
        let fixture = Fixture::new("interrupted-crash");
        let path = fixture.path("doc.json");
        let good = Doc {
            value: "last-good".to_string(),
            count: 7,
        };
        write_json_atomic(&path, &good).expect("first write should succeed");

        // Simulates the moment between temp-file write and rename: a stray
        // temp file exists, but the rename never happened.
        let stray_temp = fixture.path(".doc.json.panecrew-tmp-99999999");
        std::fs::write(&stray_temp, b"{\"value\":\"half\",\"count\":0").expect("stray temp write");

        let read = read_json(&path, Doc::default());

        assert_eq!(read, good);
        std::fs::remove_file(&stray_temp).ok();
    }
}
