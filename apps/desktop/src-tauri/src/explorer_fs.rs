//! Read-only directory tree for the explorer.
//!
//! Stateless read, like `path_probe.rs`: no persistent handle to manage, so
//! this stays a plain function annotated `#[tauri::command]` rather than a
//! manager/commands split. `kind`/`FileKind` is deliberately absent from
//! `RawTreeNode` — that's a presentational concern the frontend derives from
//! the filename (see `types/project.ts`), not something Rust needs to know.

use std::io;
use std::path::Path;

/// Directories skipped at any depth, alongside `.git`: build output and
/// dependency trees nobody browses through the explorer, and which can
/// dwarf a project's actual source by orders of magnitude.
const DENYLIST: &[&str] = &["node_modules", "target", "dist", "build", ".next", "out"];

/// Total nodes one tree read can ever return, across the whole recursion —
/// not per directory. A pathological tree (a flat folder of a million
/// generated files, a symlink cycle nobody excluded) must not hang the IPC
/// round-trip or ship an unusable payload. The cut lands on the tail of one
/// stable, already-sorted walk, exactly `path_probe.rs`'s `MAX_SUBDIRECTORIES`
/// pattern, just applied across the whole tree instead of one listing.
const MAX_ENTRIES: usize = 5000;

#[derive(serde::Serialize, Debug, Clone, PartialEq, Eq)]
pub struct RawTreeNode {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<RawTreeNode>>,
}

// `async`: a recursive directory walk over a real project (measured: ~550ms
// warm cache, ~830ms cold, against a 17k-file repo) must not run inline on
// the thread that dispatches IPC — Tauri's non-async commands execute
// synchronously wherever the webview delivers the request (verified against
// tauri-macros 2.6.3's `body_blocking` and the `on_message`/
// `run_invoke_handler` call chain in tauri 2.11.5: no thread hop at all
// without this attribute), which freezes window rendering/input for the
// whole call. `(async)` alone is enough here — no signature change, and
// `tauri::async_runtime::spawn` moves the call off that thread before it
// ever runs.
#[tauri::command(async)]
pub fn explorer_read_tree(root: String) -> Result<Vec<RawTreeNode>, String> {
    let mut budget = MAX_ENTRIES;
    walk(Path::new(&root), &mut budget)
        .map_err(|error| format!("Verzeichnis konnte nicht gelesen werden: {error}"))
}

/// Creates an empty file at `path`. Refuses to overwrite an existing one
/// (`create_new` fails atomically rather than racing a separate existence
/// check) and does not create a missing parent directory — this command
/// adds one entry to an already-visible folder, nothing more.
#[tauri::command]
pub fn explorer_create_file(path: String) -> Result<(), String> {
    std::fs::File::create_new(&path)
        .map(|_file| ())
        .map_err(|error| format!("Datei konnte nicht angelegt werden: {error}"))
}

/// Creates an empty directory at `path`. `create_dir`, not `create_dir_all`:
/// refuses both an already-existing target and a missing parent, for the
/// same reason `explorer_create_file` refuses both.
#[tauri::command]
pub fn explorer_create_directory(path: String) -> Result<(), String> {
    std::fs::create_dir(&path)
        .map_err(|error| format!("Ordner konnte nicht angelegt werden: {error}"))
}

/// The mini editor loads a whole file into one `<textarea>` — refusing
/// anything above a sane ceiling keeps that plan-text-only, in-memory
/// approach from freezing the app on an accidental huge file.
const MAX_EDITABLE_FILE_BYTES: u64 = 1024 * 1024;

/// A file's on-disk identity at read time, round-tripped back into
/// `explorer_write_file` so it can refuse to overwrite a file that changed
/// underneath PaneCrew (e.g. a CLI agent editing the same tree) instead of
/// silently clobbering it.
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileStamp {
    pub modified_ms: u64,
    pub len: u64,
}

#[derive(serde::Serialize, Debug, Clone, PartialEq, Eq)]
pub struct FileContents {
    /// Always LF-normalized, regardless of the file's actual line endings —
    /// a `<textarea>`'s `.value` normalizes to LF anyway, so this is what the
    /// frontend needs; `crlf` lets `explorer_write_file` restore the original
    /// ending on save instead of rewriting every line of a CRLF file.
    pub text: String,
    pub crlf: bool,
    pub stamp: FileStamp,
}

fn file_stamp(metadata: &std::fs::Metadata) -> Result<FileStamp, String> {
    let modified_ms = metadata
        .modified()
        .and_then(|modified| {
            modified
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|error| io::Error::other(error.to_string()))
        })
        .map_err(|error| format!("Änderungszeitpunkt konnte nicht gelesen werden: {error}"))?
        .as_millis() as u64;
    Ok(FileStamp {
        modified_ms,
        len: metadata.len(),
    })
}

/// Reads a file for the mini editor. The size check happens against
/// `metadata()` first, before any byte of the file is read into memory, so a
/// huge file is refused up front rather than after loading it.
// `async`: same reasoning as `explorer_read_tree` — full-file reads must not
// run on the thread that dispatches IPC.
#[tauri::command(async)]
pub fn explorer_read_file(path: String) -> Result<FileContents, String> {
    let metadata = std::fs::metadata(&path)
        .map_err(|error| format!("Datei konnte nicht gelesen werden: {error}"))?;
    if metadata.is_dir() {
        return Err("Ordner können nicht im Editor geöffnet werden".to_string());
    }
    if metadata.len() > MAX_EDITABLE_FILE_BYTES {
        return Err(format!(
            "Datei ist zu groß für den Editor ({} Bytes, Grenze {MAX_EDITABLE_FILE_BYTES} Bytes)",
            metadata.len()
        ));
    }

    let bytes =
        std::fs::read(&path).map_err(|error| format!("Datei konnte nicht gelesen werden: {error}"))?;
    // `from_utf8`, never the `_lossy` sibling: lossy decoding silently turns
    // invalid bytes into U+FFFD, and writing that back out would corrupt a
    // binary file instead of refusing to open it.
    let raw = String::from_utf8(bytes)
        .map_err(|_error| "Datei ist keine UTF-8-Textdatei und kann nicht bearbeitet werden".to_string())?;
    let crlf = raw.contains("\r\n");
    let text = if crlf { raw.replace("\r\n", "\n") } else { raw };
    let stamp = file_stamp(&metadata)?;
    Ok(FileContents { text, crlf, stamp })
}

/// Removes its temp file on drop — a `?` on any step between creating the
/// temp file and the final rename in `explorer_write_file` must not leave a
/// `.panecrew-tmp-*` file behind. Harmless to run after a successful rename
/// too: the temp path is already gone by then, so the removal is a no-op.
struct TempFileGuard(std::path::PathBuf);

impl Drop for TempFileGuard {
    fn drop(&mut self) {
        std::fs::remove_file(&self.0).ok();
    }
}

/// Writes `contents` back to `path` — but only if `expected` (the stamp
/// `explorer_read_file` returned when the edit started) still matches the
/// file's current on-disk stamp. A mismatch means something outside
/// PaneCrew changed the file since — the most likely data-loss scenario in
/// an app whose whole point is a CLI agent editing the same tree the user
/// has open, so this refuses to write rather than silently clobbering it.
/// To force the write through anyway, call again with `expected` set to the
/// file's current stamp (e.g. re-read it first).
///
/// The write itself never touches the target in place: contents go to a
/// sibling temp file first, `sync_all()`'d before the rename, so a crash
/// between writing and renaming leaves either the old file or the new one
/// intact, never a half-written one.
// `async`: same reasoning as `explorer_read_tree` — the sync-then-rename
// write must not run on the thread that dispatches IPC.
#[tauri::command(async)]
pub fn explorer_write_file(
    path: String,
    contents: String,
    crlf: bool,
    expected: FileStamp,
) -> Result<FileStamp, String> {
    use std::io::Write;

    let path = std::fs::canonicalize(&path)
        .map_err(|error| format!("Datei konnte nicht gefunden werden: {error}"))?;
    let metadata = std::fs::metadata(&path)
        .map_err(|error| format!("Datei konnte nicht gelesen werden: {error}"))?;
    if file_stamp(&metadata)? != expected {
        return Err("Datei wurde außerhalb von PaneCrew geändert".to_string());
    }

    let dir = path
        .parent()
        .ok_or_else(|| "Datei hat kein Elternverzeichnis".to_string())?;
    let file_name = path
        .file_name()
        .ok_or_else(|| "Ungültiger Dateiname".to_string())?
        .to_string_lossy();
    // In the target's own directory, not `env::temp_dir()`: a rename across
    // filesystem/device boundaries isn't atomic (and can outright fail).
    let temp_path = dir.join(format!(".{file_name}.panecrew-tmp-{}", std::process::id()));

    let bytes = if crlf {
        contents.replace('\n', "\r\n").into_bytes()
    } else {
        contents.into_bytes()
    };

    let mut file = std::fs::File::create(&temp_path)
        .map_err(|error| format!("Temporäre Datei konnte nicht angelegt werden: {error}"))?;
    let guard = TempFileGuard(temp_path.clone());
    file.write_all(&bytes)
        .map_err(|error| format!("Datei konnte nicht geschrieben werden: {error}"))?;
    // Without this, a crash right after the rename below can still leave a
    // 0-byte or partially flushed file — the actual corruption case "never
    // acceptable" refers to.
    file.sync_all()
        .map_err(|error| format!("Datei konnte nicht geschrieben werden: {error}"))?;
    drop(file);
    // Applies mode bits on unix, the readonly flag on windows — otherwise a
    // save silently drops e.g. a shell script's executable bit.
    std::fs::set_permissions(&temp_path, metadata.permissions()).ok();

    std::fs::rename(&temp_path, &path)
        .map_err(|error| format!("Datei konnte nicht gespeichert werden: {error}"))?;
    drop(guard);

    let metadata = std::fs::metadata(&path)
        .map_err(|error| format!("Datei konnte nicht gelesen werden: {error}"))?;
    file_stamp(&metadata)
}

/// `budget` is shared across the whole recursion (decremented, never reset
/// per directory), so the cap holds for the tree as a whole. Once it hits
/// zero, remaining siblings and their subtrees are silently dropped instead
/// of erroring — same "sorted-first truncation" contract as the entries kept.
fn walk(dir: &Path, budget: &mut usize) -> io::Result<Vec<RawTreeNode>> {
    let mut entries: Vec<std::fs::DirEntry> = std::fs::read_dir(dir)?.flatten().collect();

    entries.retain(|entry| {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        name != ".git" && !DENYLIST.contains(&name.as_ref())
    });

    // Folders before files, both case-insensitive — same convention
    // `path_probe.rs` already uses for its own directory listing.
    entries.sort_by(|a, b| {
        let a_is_dir = a.path().is_dir();
        let b_is_dir = b.path().is_dir();
        a_is_dir
            .cmp(&b_is_dir)
            .reverse()
            .then_with(|| {
                a.file_name()
                    .to_string_lossy()
                    .to_lowercase()
                    .cmp(&b.file_name().to_string_lossy().to_lowercase())
            })
    });

    let mut nodes = Vec::new();
    for entry in entries {
        if *budget == 0 {
            break;
        }
        *budget -= 1;

        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();
        let children = if path.is_dir() {
            Some(walk(&path, budget)?)
        } else {
            None
        };
        nodes.push(RawTreeNode { name, children });
    }
    Ok(nodes)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A throwaway tree under the system temp dir, removed by `drop` — same
    /// shape as `path_probe.rs`'s own `Fixture`.
    struct Fixture(std::path::PathBuf);

    impl Fixture {
        fn new(name: &str, entries: &[&str]) -> Self {
            let root = std::env::temp_dir()
                .join(format!("panecrew-explorer-fs-{}-{name}", std::process::id()));
            std::fs::remove_dir_all(&root).ok();
            // `entries` may be empty (fixtures that only need a bare root to
            // create things into) — the loop below would then never call
            // `create_dir_all` at all, so the root itself needs its own call.
            std::fs::create_dir_all(&root).expect("test fixture root should be creatable");
            for entry in entries {
                match entry.strip_suffix('/') {
                    Some(dir) => std::fs::create_dir_all(root.join(dir)),
                    None => std::fs::create_dir_all(root.join(entry).parent().expect("has parent"))
                        .and_then(|()| std::fs::write(root.join(entry), b"x")),
                }
                .expect("test fixture should be creatable");
            }
            Self(root)
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.0).ok();
        }
    }

    fn node(name: &str, children: Option<Vec<RawTreeNode>>) -> RawTreeNode {
        RawTreeNode {
            name: name.to_string(),
            children,
        }
    }

    #[test]
    fn lists_folders_before_files_both_case_insensitive() {
        let fixture = Fixture::new(
            "sort",
            &["zeta/", "Alpha/", "readme.md", "Cargo.toml", "beta.rs"],
        );

        let mut budget = usize::MAX;
        let tree = walk(&fixture.0, &mut budget).expect("readable fixture");

        assert_eq!(
            tree,
            vec![
                node("Alpha", Some(vec![])),
                node("zeta", Some(vec![])),
                node("beta.rs", None),
                node("Cargo.toml", None),
                node("readme.md", None),
            ]
        );
    }

    #[test]
    fn excludes_git_and_denylisted_directories_at_any_depth() {
        let fixture = Fixture::new(
            "denylist",
            &[
                ".git/HEAD",
                "node_modules/left-pad/index.js",
                "src/target/debug/build",
                "src/main.rs",
            ],
        );

        let mut budget = usize::MAX;
        let tree = walk(&fixture.0, &mut budget).expect("readable fixture");

        assert_eq!(
            tree,
            vec![node("src", Some(vec![node("main.rs", None)]))]
        );
    }

    #[test]
    fn truncates_beyond_the_cap_instead_of_erroring() {
        let fixture = Fixture::new("cap", &["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"]);

        let mut budget = 3;
        let tree = walk(&fixture.0, &mut budget).expect("readable fixture");

        assert_eq!(tree.len(), 3);
        assert_eq!(budget, 0);
        // The cut is the tail of one stable, sorted list.
        assert_eq!(tree[0].name, "a.txt");
        assert_eq!(tree[2].name, "c.txt");
    }

    #[test]
    fn caps_across_the_whole_recursion_not_per_directory() {
        let fixture = Fixture::new(
            "recursive-cap",
            &["dir/x.txt", "dir/y.txt", "dir/z.txt", "top.txt"],
        );

        // Budget covers "dir" itself as one entry, leaving 1 for its children.
        let mut budget = 2;
        let tree = walk(&fixture.0, &mut budget).expect("readable fixture");

        assert_eq!(tree, vec![node("dir", Some(vec![node("x.txt", None)]))]);
        assert_eq!(budget, 0);
    }

    #[test]
    fn errors_on_an_unreadable_root_instead_of_returning_an_empty_tree() {
        let missing = std::env::temp_dir().join("panecrew-explorer-fs-definitely-missing");

        assert!(explorer_read_tree(missing.to_string_lossy().into_owned()).is_err());
    }

    #[test]
    fn creates_an_empty_file() {
        let fixture = Fixture::new("create-file", &[]);
        let path = fixture.0.join("new.txt");

        explorer_create_file(path.to_string_lossy().into_owned()).expect("should create");

        assert_eq!(std::fs::read(&path).expect("file should exist"), b"");
    }

    #[test]
    fn refuses_to_overwrite_an_existing_file() {
        let fixture = Fixture::new("create-file-exists", &["already.txt"]);
        let path = fixture.0.join("already.txt");
        std::fs::write(&path, b"original").expect("fixture write");

        let result = explorer_create_file(path.to_string_lossy().into_owned());

        assert!(result.is_err());
        assert_eq!(std::fs::read(&path).expect("file should still exist"), b"original");
    }

    #[test]
    fn refuses_to_create_a_file_whose_parent_directory_is_missing() {
        let fixture = Fixture::new("create-file-no-parent", &[]);
        let path = fixture.0.join("nope").join("new.txt");

        let result = explorer_create_file(path.to_string_lossy().into_owned());

        assert!(result.is_err());
        assert!(!path.exists());
    }

    #[test]
    fn creates_an_empty_directory() {
        let fixture = Fixture::new("create-dir", &[]);
        let path = fixture.0.join("new-folder");

        explorer_create_directory(path.to_string_lossy().into_owned()).expect("should create");

        assert!(path.is_dir());
    }

    #[test]
    fn refuses_to_create_a_directory_that_already_exists() {
        let fixture = Fixture::new("create-dir-exists", &["already/"]);
        let path = fixture.0.join("already");

        let result = explorer_create_directory(path.to_string_lossy().into_owned());

        assert!(result.is_err());
    }

    #[test]
    fn refuses_to_create_a_directory_whose_parent_is_missing() {
        let fixture = Fixture::new("create-dir-no-parent", &[]);
        let path = fixture.0.join("nope").join("new-folder");

        let result = explorer_create_directory(path.to_string_lossy().into_owned());

        assert!(result.is_err());
        assert!(!path.exists());
    }

    #[test]
    fn reads_a_normal_utf8_file_exactly() {
        let fixture = Fixture::new("read-utf8", &[]);
        let path = fixture.0.join("readme.md");
        std::fs::write(&path, "Hällo, Wörld\nzweite Zeile").expect("fixture write");

        let contents =
            explorer_read_file(path.to_string_lossy().into_owned()).expect("should read");

        assert_eq!(contents.text, "Hällo, Wörld\nzweite Zeile");
        assert!(!contents.crlf);
        assert_eq!(contents.stamp.len, "Hällo, Wörld\nzweite Zeile".len() as u64);
    }

    #[test]
    fn detects_and_normalizes_crlf_line_endings() {
        let fixture = Fixture::new("read-crlf", &[]);
        let path = fixture.0.join("windows.txt");
        std::fs::write(&path, b"first\r\nsecond\r\n").expect("fixture write");

        let contents =
            explorer_read_file(path.to_string_lossy().into_owned()).expect("should read");

        assert!(contents.crlf);
        assert_eq!(contents.text, "first\nsecond\n");
    }

    #[test]
    fn refuses_non_utf8_content_instead_of_returning_garbled_text() {
        let fixture = Fixture::new("read-non-utf8", &[]);
        let path = fixture.0.join("binary.dat");
        std::fs::write(&path, [0xFF, 0xFE, 0x00, 0x01]).expect("fixture write");

        let result = explorer_read_file(path.to_string_lossy().into_owned());

        assert!(result.is_err());
    }

    #[test]
    fn refuses_a_file_above_the_size_ceiling() {
        let fixture = Fixture::new("read-too-large", &[]);
        let path = fixture.0.join("huge.txt");
        std::fs::write(&path, vec![b'a'; (MAX_EDITABLE_FILE_BYTES + 1) as usize])
            .expect("fixture write");

        let result = explorer_read_file(path.to_string_lossy().into_owned());

        assert!(result.is_err());
    }

    #[test]
    fn refuses_to_open_a_directory_in_the_editor() {
        let fixture = Fixture::new("read-directory", &["subdir/"]);
        let path = fixture.0.join("subdir");

        let result = explorer_read_file(path.to_string_lossy().into_owned());

        assert!(result.is_err());
    }

    #[test]
    fn errors_on_a_missing_file_instead_of_panicking() {
        let fixture = Fixture::new("read-missing", &[]);
        let path = fixture.0.join("nope.txt");

        let result = explorer_read_file(path.to_string_lossy().into_owned());

        assert!(result.is_err());
    }

    #[test]
    fn write_then_read_round_trips_the_new_content() {
        let fixture = Fixture::new("write-roundtrip", &[]);
        let path = fixture.0.join("file.txt");
        std::fs::write(&path, "original").expect("fixture write");
        let path = path.to_string_lossy().into_owned();
        let stamp = explorer_read_file(path.clone()).expect("should read").stamp;

        explorer_write_file(path.clone(), "changed".to_string(), false, stamp)
            .expect("should write");

        assert_eq!(
            explorer_read_file(path).expect("should read back").text,
            "changed"
        );
    }

    #[test]
    fn refuses_to_write_when_the_file_changed_on_disk_since_the_stamp() {
        let fixture = Fixture::new("write-conflict", &[]);
        let path = fixture.0.join("file.txt");
        std::fs::write(&path, "original").expect("fixture write");
        let path_string = path.to_string_lossy().into_owned();
        let stale_stamp = explorer_read_file(path_string.clone())
            .expect("should read")
            .stamp;
        // Change the file "externally" (e.g. a CLI agent) after the stamp
        // was taken, without going through `explorer_write_file`.
        std::fs::write(&path, "changed by someone else").expect("simulated external edit");

        let result = explorer_write_file(
            path_string.clone(),
            "clobbered?".to_string(),
            false,
            stale_stamp,
        );

        assert!(result.is_err());
        assert_eq!(
            std::fs::read_to_string(&path).expect("file should still exist"),
            "changed by someone else"
        );
    }

    #[test]
    fn leaves_no_temp_file_behind_after_a_conflict_refusal() {
        let fixture = Fixture::new("write-conflict-no-litter", &[]);
        let path = fixture.0.join("file.txt");
        std::fs::write(&path, "original").expect("fixture write");
        let path_string = path.to_string_lossy().into_owned();
        let stale_stamp = explorer_read_file(path_string.clone())
            .expect("should read")
            .stamp;
        std::fs::write(&path, "changed by someone else").expect("simulated external edit");

        let _ = explorer_write_file(path_string, "clobbered?".to_string(), false, stale_stamp);

        let leftovers: Vec<_> = std::fs::read_dir(&fixture.0)
            .expect("fixture dir readable")
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().contains("panecrew-tmp"))
            .collect();
        assert!(leftovers.is_empty());
    }

    #[test]
    fn preserves_the_original_files_permissions_after_a_write() {
        use std::os::unix::fs::PermissionsExt;

        let fixture = Fixture::new("write-preserves-mode", &[]);
        let path = fixture.0.join("script.sh");
        std::fs::write(&path, "#!/bin/sh\necho hi").expect("fixture write");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
            .expect("fixture chmod");
        let path_string = path.to_string_lossy().into_owned();
        let stamp = explorer_read_file(path_string.clone())
            .expect("should read")
            .stamp;

        explorer_write_file(path_string, "#!/bin/sh\necho bye".to_string(), false, stamp)
            .expect("should write");

        let mode = std::fs::metadata(&path).expect("readable").permissions().mode();
        assert_eq!(mode & 0o777, 0o755);
    }

    #[test]
    fn restores_crlf_line_endings_on_write() {
        let fixture = Fixture::new("write-crlf", &[]);
        let path = fixture.0.join("windows.txt");
        std::fs::write(&path, b"first\r\nsecond\r\n").expect("fixture write");
        let path_string = path.to_string_lossy().into_owned();
        let read = explorer_read_file(path_string.clone()).expect("should read");
        assert!(read.crlf);

        explorer_write_file(
            path_string,
            "first\nsecond\nthird".to_string(),
            true,
            read.stamp,
        )
        .expect("should write");

        let bytes = std::fs::read(&path).expect("readable");
        assert_eq!(bytes, b"first\r\nsecond\r\nthird");
    }

    #[test]
    fn refuses_to_write_a_file_that_does_not_exist() {
        let fixture = Fixture::new("write-missing", &[]);
        let path = fixture.0.join("nope.txt");

        let result = explorer_write_file(
            path.to_string_lossy().into_owned(),
            "content".to_string(),
            false,
            FileStamp { modified_ms: 0, len: 0 },
        );

        assert!(result.is_err());
    }
}
