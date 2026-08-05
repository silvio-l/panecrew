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

#[tauri::command]
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
}
