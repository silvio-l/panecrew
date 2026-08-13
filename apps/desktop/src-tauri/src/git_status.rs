//! Read-only git status for the explorer's change decorations (reference editors call
//! these "SCM decorations": a modified/untracked file's name is colored, and
//! the color propagates up to its ancestor folders).
//!
//! Shells out to the user's own `git`, same trust boundary `shell_history.rs`
//! already relies on for the user's shell. A project that isn't a git repo,
//! or a missing `git` binary, is not an error worth surfacing — decorations
//! are a pure add-on, an empty list just means "nothing to show".

use std::process::Command;

/// Same reasoning and cap as `explorer_fs.rs::MAX_ENTRIES`: unlike the tree
/// read, this had no ceiling at all — a project with a huge untracked/dirty
/// set (a fresh `node_modules` before `.gitignore` applies, a massive
/// generated-file diff) could return tens of thousands of entries with
/// nothing bounding the IPC payload or the frontend's per-file decoration
/// work downstream.
const MAX_ENTRIES: usize = 5000;

#[derive(serde::Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GitChangeStatus {
    Modified,
    Untracked,
}

#[derive(serde::Serialize, Debug, Clone, PartialEq, Eq)]
pub struct GitFileStatus {
    /// Relative to `root`, forward-slash separated — git's porcelain output
    /// already uses `/` on every platform, matching `explorer_read_tree`'s
    /// own path convention (see `explorer_fs.rs`).
    pub path: String,
    pub status: GitChangeStatus,
}

// `async`: shells out to a real `git` process and waits for it — measured
// up to ~7s cold-cache, ~1.2s warm, against a 17k-file repo. A non-async
// `#[tauri::command]` runs inline on the thread that dispatches IPC (no
// spawn anywhere between `on_message` and the command call — verified
// against tauri 2.11.5's source), so without this the entire window freezes
// for the whole subprocess wait. `async_runtime::spawn` moves it off first.
#[tauri::command(async)]
pub fn explorer_git_status(root: String) -> Vec<GitFileStatus> {
    let Ok(output) = Command::new("git")
        .args([
            "-C",
            &root,
            "status",
            "--porcelain=v1",
            "--untracked-files=all",
            "-z",
        ])
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        // Most commonly: `root` isn't a git repository at all.
        return Vec::new();
    }
    parse_porcelain(&output.stdout)
}

/// `-z` output is NUL-separated instead of newline-separated specifically so
/// paths with spaces, quotes, or newlines round-trip without git's usual
/// quoting/escaping — this parser relies on that (no unescaping needed).
fn parse_porcelain(output: &[u8]) -> Vec<GitFileStatus> {
    let text = String::from_utf8_lossy(output);
    let mut tokens = text.split('\0').filter(|token| !token.is_empty());
    let mut statuses = Vec::new();

    while let Some(entry) = tokens.next() {
        if statuses.len() >= MAX_ENTRIES {
            break;
        }
        let Some((xy, rest)) = entry.split_at_checked(2) else {
            continue;
        };
        let path = rest.strip_prefix(' ').unwrap_or(rest);
        let mut bytes = xy.bytes();
        let (Some(x), Some(y)) = (bytes.next(), bytes.next()) else {
            continue;
        };

        // A rename/copy entry carries its origin path as a second, separate
        // token right after this one. That origin path no longer exists at
        // its old location, so it has nothing to decorate — only `path`
        // (the new location) does.
        if x == b'R' || x == b'C' {
            tokens.next();
        }

        // A path git reports as deleted can never appear in a tree read from
        // the real filesystem, so there is no node left to decorate.
        if x == b'D' || y == b'D' {
            continue;
        }

        let status = if x == b'?' && y == b'?' {
            GitChangeStatus::Untracked
        } else {
            GitChangeStatus::Modified
        };
        statuses.push(GitFileStatus {
            path: path.to_string(),
            status,
        });
    }

    statuses
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn reports_an_unstaged_modification() {
        let statuses = parse_porcelain(b" M src/main.rs\0");
        assert_eq!(
            statuses,
            vec![GitFileStatus {
                path: "src/main.rs".into(),
                status: GitChangeStatus::Modified,
            }]
        );
    }

    #[test]
    fn reports_a_staged_addition_as_modified() {
        let statuses = parse_porcelain(b"A  src/added.rs\0");
        assert_eq!(statuses[0].status, GitChangeStatus::Modified);
    }

    #[test]
    fn reports_an_untracked_file() {
        let statuses = parse_porcelain(b"?? src/new.rs\0");
        assert_eq!(
            statuses,
            vec![GitFileStatus {
                path: "src/new.rs".into(),
                status: GitChangeStatus::Untracked,
            }]
        );
    }

    #[test]
    fn skips_a_deleted_file_since_no_tree_node_can_exist_for_it() {
        let statuses = parse_porcelain(b" D src/gone.rs\0");
        assert!(statuses.is_empty());
    }

    #[test]
    fn takes_the_destination_path_of_a_rename_and_skips_the_origin_token() {
        let statuses = parse_porcelain(b"R  new/path.rs\0old/path.rs\0?? other.rs\0");
        assert_eq!(
            statuses,
            vec![
                GitFileStatus {
                    path: "new/path.rs".into(),
                    status: GitChangeStatus::Modified,
                },
                GitFileStatus {
                    path: "other.rs".into(),
                    status: GitChangeStatus::Untracked,
                },
            ]
        );
    }

    #[test]
    fn parses_several_entries_in_one_z_separated_stream() {
        let statuses = parse_porcelain(b" M src/main.rs\0?? src/new.rs\0");
        assert_eq!(statuses.len(), 2);
    }

    #[test]
    fn caps_the_result_instead_of_returning_an_unbounded_list() {
        let mut raw = Vec::new();
        for index in 0..(MAX_ENTRIES + 10) {
            raw.extend_from_slice(format!("?? file{index}.txt\0").as_bytes());
        }

        let statuses = parse_porcelain(&raw);

        assert_eq!(statuses.len(), MAX_ENTRIES);
    }

    /// A throwaway git repo under the system temp dir, removed by `drop`.
    struct GitFixture(std::path::PathBuf);

    impl GitFixture {
        fn new(name: &str) -> Self {
            let root =
                std::env::temp_dir().join(format!("panecrew-git-status-{}-{name}", std::process::id()));
            std::fs::remove_dir_all(&root).ok();
            std::fs::create_dir_all(&root).expect("test fixture dir should be creatable");
            run(&root, &["init", "-q"]);
            run(&root, &["config", "user.email", "test@panecrew.local"]);
            run(&root, &["config", "user.name", "PaneCrew Test"]);
            Self(root)
        }

        fn write(&self, relative: &str, contents: &str) {
            let path = self.0.join(relative);
            std::fs::create_dir_all(path.parent().expect("has parent"))
                .expect("fixture subdirectory should be creatable");
            std::fs::write(path, contents).expect("fixture file should be writable");
        }

        fn commit_all(&self) {
            run(&self.0, &["add", "-A"]);
            run(&self.0, &["commit", "-q", "-m", "initial"]);
        }

        fn root(&self) -> String {
            self.0.to_string_lossy().into_owned()
        }
    }

    impl Drop for GitFixture {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.0).ok();
        }
    }

    fn run(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .status()
            .expect("git should be installed for this test");
        assert!(status.success(), "git {args:?} should succeed");
    }

    #[test]
    fn a_directory_that_is_not_a_git_repo_reports_no_status() {
        let root = std::env::temp_dir().join("panecrew-git-status-not-a-repo");
        std::fs::create_dir_all(&root).expect("plain dir should be creatable");

        let statuses = explorer_git_status(root.to_string_lossy().into_owned());

        assert!(statuses.is_empty());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn reports_real_modified_and_untracked_files_from_an_actual_repo() {
        let fixture = GitFixture::new("live");
        fixture.write("tracked.txt", "original\n");
        fixture.commit_all();
        fixture.write("tracked.txt", "changed\n");
        fixture.write("brand-new.txt", "new\n");

        let mut statuses = explorer_git_status(fixture.root());
        statuses.sort_by(|a, b| a.path.cmp(&b.path));

        assert_eq!(
            statuses,
            vec![
                GitFileStatus {
                    path: "brand-new.txt".into(),
                    status: GitChangeStatus::Untracked,
                },
                GitFileStatus {
                    path: "tracked.txt".into(),
                    status: GitChangeStatus::Modified,
                },
            ]
        );
    }
}
