//! Read-only git status for the explorer's change decorations (reference editors call
//! these "SCM decorations": a modified/untracked file's name is colored, and
//! the color propagates up to its ancestor folders) plus repo-level metadata
//! (current branch, ahead/behind against its upstream, worktree membership) —
//! all fed from one `git2` (libgit2, vendored — see
//! docs/adr/0011-git2-vendored-over-gix.md) read of the same repository, one
//! IPC round trip for both the explorer header and `GridStatusRail`.
//!
//! No shellout to system `git` (migrated away from it, ADR referenced above)
//! and no write operations anywhere in this module — strictly read-only
//! (ADR 0010). A project that isn't a git repo is not an error worth
//! surfacing — every field on `GitRepoStatus` just comes back empty/`None`.

use std::path::{Path, PathBuf};

use git2::{ErrorCode, Repository, Status, StatusOptions};

/// Same reasoning and cap as `explorer_fs.rs::MAX_ENTRIES`: unlike the tree
/// read, this had no ceiling at all — a project with a huge untracked/dirty
/// set (a fresh `node_modules` before `.gitignore` applies, a massive
/// generated-file diff) could return tens of thousands of entries with
/// nothing bounding the IPC payload or the frontend's per-file decoration
/// work downstream.
const MAX_ENTRIES: usize = 5000;

#[derive(serde::Serialize, Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum GitFileState {
    Staged,
    Unstaged,
    Conflicted,
    Untracked,
}

#[derive(serde::Serialize, Debug, Clone, PartialEq, Eq)]
pub struct GitFileStatus {
    /// Relative to `root` (the explorer project root passed into
    /// `explorer_git_status`), forward-slash separated on every platform —
    /// matching `explorer_read_tree`'s own path convention. Usually also
    /// relative to the repo's workdir, except when `root` is a subdirectory
    /// nested inside a larger repo (git itself walks upward to find `.git`
    /// the same way `Repository::discover` does below): an entry outside
    /// `root`'s own subtree then carries a `../`-prefixed path, exactly what
    /// a real `git status` run from inside `root` would print.
    pub path: String,
    /// A file can be in more than one state at once — e.g. partially staged
    /// (some hunks staged, the rest still unstaged), or staged-then-further-
    /// edited.
    pub states: Vec<GitFileState>,
}

#[derive(serde::Serialize, Debug, Clone, PartialEq, Eq)]
pub struct GitBranchStatus {
    /// `None` for a detached HEAD (`detached: true`) or when the repo's HEAD
    /// can't be resolved at all.
    pub name: Option<String>,
    pub detached: bool,
    /// Commits ahead of the branch's configured upstream. `None` (not `0`)
    /// when there is no upstream configured, or on a detached HEAD — "no
    /// data", not "zero difference".
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
}

#[derive(serde::Serialize, Debug, Clone, PartialEq, Eq)]
pub struct GitWorktreeStatus {
    /// The main repository's folder name — the worktree's own checked-out
    /// branch is already `GitRepoStatus::branch`, no need to duplicate it
    /// here.
    pub main_repo_name: String,
}

#[derive(serde::Serialize, Debug, Clone, PartialEq, Eq, Default)]
pub struct GitRepoStatus {
    pub files: Vec<GitFileStatus>,
    /// `None` only when `root` isn't a git repository at all (or has no
    /// working directory, e.g. a bare repo) — for any real repo this is
    /// always `Some`, even on a detached HEAD.
    pub branch: Option<GitBranchStatus>,
    /// `Some` only when `root`'s repo is itself a linked worktree of another,
    /// main repository — PaneCrew never creates or manages worktrees itself,
    /// this is passive detection for display only.
    pub worktree: Option<GitWorktreeStatus>,
}

// `async`: opens a repo and walks its status — measured up to ~7s cold-cache
// against a 17k-file repo when this shelled out to `git`; git2 reads the same
// on-disk state, so the same cost applies. A non-async `#[tauri::command]`
// runs inline on the thread that dispatches IPC (no spawn anywhere between
// `on_message` and the command call — verified against tauri 2.11.5's
// source), so without this the entire window freezes for the whole call.
// `async_runtime::spawn` moves it off first.
#[tauri::command(async)]
pub fn explorer_git_status(root: String) -> GitRepoStatus {
    let root_path = Path::new(&root);
    let Ok(repo) = Repository::discover(root_path) else {
        return GitRepoStatus::default();
    };
    // A bare repo has no working directory to decorate a tree against — the
    // explorer only ever opens real folders on disk, so this can't currently
    // happen in practice, but it's the same "not an error, just nothing to
    // show" fallback as every other not-really-a-project-repo case here.
    let Some(workdir) = repo.workdir() else {
        return GitRepoStatus::default();
    };

    GitRepoStatus {
        files: collect_file_statuses(&repo, workdir, root_path),
        branch: Some(collect_branch_status(&repo)),
        worktree: collect_worktree_status(&repo),
    }
}

fn collect_file_statuses(repo: &Repository, workdir: &Path, root: &Path) -> Vec<GitFileStatus> {
    let mut options = StatusOptions::new();
    options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        // `git status` (unlike plain `git diff`) detects renames by default —
        // without this, a renamed file shows as a plain delete (skipped
        // below, nothing to decorate) plus an unrelated add.
        .renames_head_to_index(true)
        .renames_index_to_workdir(true);
    let Ok(statuses) = repo.statuses(Some(&mut options)) else {
        return Vec::new();
    };

    let workdir_canon = canonicalize_or_self(workdir);
    let root_canon = canonicalize_or_self(root);
    let same_root = workdir_canon == root_canon;

    let mut result = Vec::new();
    for entry in statuses.iter() {
        if result.len() >= MAX_ENTRIES {
            break;
        }
        let status = entry.status();
        // Ignored files never reach here anyway (StatusOptions defaults to
        // excluding them), but a deleted path — staged or not — can never
        // appear in a tree read from the real filesystem, so there is no
        // node left to decorate.
        if status.intersects(Status::INDEX_DELETED | Status::WT_DELETED) {
            continue;
        }
        let Some(repo_relative) = display_path(&entry) else {
            continue;
        };

        let mut states = Vec::new();
        if status.contains(Status::CONFLICTED) {
            states.push(GitFileState::Conflicted);
        }
        if status.intersects(
            Status::INDEX_NEW
                | Status::INDEX_MODIFIED
                | Status::INDEX_RENAMED
                | Status::INDEX_TYPECHANGE,
        ) {
            states.push(GitFileState::Staged);
        }
        if status.contains(Status::WT_NEW) {
            states.push(GitFileState::Untracked);
        } else if status
            .intersects(Status::WT_MODIFIED | Status::WT_RENAMED | Status::WT_TYPECHANGE)
        {
            states.push(GitFileState::Unstaged);
        }
        if states.is_empty() {
            continue;
        }

        let path = if same_root {
            repo_relative
        } else {
            path_diff(&root_canon, &workdir_canon.join(&repo_relative))
        };
        result.push(GitFileStatus { path, states });
    }
    result
}

/// The new/current path for this entry — for a rename this is the
/// destination, never the origin (which no longer exists to decorate). A
/// `StatusEntry` carries at least one of `head_to_index`/`index_to_workdir`;
/// `DiffFile::path()` on either delta's `new_file()` is always the file's
/// current location, renamed or not.
fn display_path(entry: &git2::StatusEntry<'_>) -> Option<String> {
    let path = entry
        .head_to_index()
        .and_then(|delta| delta.new_file().path().map(Path::to_path_buf))
        .or_else(|| {
            entry
                .index_to_workdir()
                .and_then(|delta| delta.new_file().path().map(Path::to_path_buf))
        })
        .or_else(|| entry.path().map(PathBuf::from))?;
    Some(path.to_string_lossy().replace('\\', "/"))
}

fn collect_branch_status(repo: &Repository) -> GitBranchStatus {
    let (name, detached) = match repo.head() {
        Ok(head_ref) if head_ref.is_branch() => (head_ref.shorthand().map(str::to_string), false),
        // HEAD resolves to something that isn't a branch (a detached
        // checkout of a commit/tag).
        Ok(_) => (None, true),
        // A brand-new repo with no commits yet still points HEAD at a named
        // branch symbolically — worth surfacing rather than falling back to
        // "no branch at all".
        Err(error) if error.code() == ErrorCode::UnbornBranch => {
            let name = repo
                .find_reference("HEAD")
                .ok()
                .and_then(|reference| reference.symbolic_target().map(str::to_string))
                .and_then(|target| target.strip_prefix("refs/heads/").map(str::to_string));
            (name, false)
        }
        Err(_) => (None, false),
    };

    let (ahead, behind) = match (&name, detached) {
        (Some(branch_name), false) => ahead_behind(repo, branch_name),
        _ => (None, None),
    };

    GitBranchStatus {
        name,
        detached,
        ahead,
        behind,
    }
}

fn ahead_behind(repo: &Repository, branch_name: &str) -> (Option<u32>, Option<u32>) {
    let local_ref = format!("refs/heads/{branch_name}");
    let Ok(upstream_buf) = repo.branch_upstream_name(&local_ref) else {
        return (None, None);
    };
    let Some(upstream_ref) = upstream_buf.as_str() else {
        return (None, None);
    };
    let (Ok(local_oid), Ok(upstream_oid)) = (
        repo.refname_to_id(&local_ref),
        repo.refname_to_id(upstream_ref),
    ) else {
        return (None, None);
    };
    match repo.graph_ahead_behind(local_oid, upstream_oid) {
        // `usize` on a real repo's ahead/behind count never approaches
        // `u32::MAX` — a display count, not an exact-precision value.
        #[allow(clippy::cast_possible_truncation)]
        Ok((ahead, behind)) => (Some(ahead as u32), Some(behind as u32)),
        Err(_) => (None, None),
    }
}

/// Passive worktree detection (never creates/manages one, see
/// `docs/decisions.md` → Nachtrag 2026-08-16): a folder opened as a project
/// is a linked worktree when its `.git` is a file pointing at
/// `<main-repo>/.git/worktrees/<name>` rather than being the repo's own
/// `.git` directory — exactly what `Repository::is_worktree()` already
/// determines for us.
fn collect_worktree_status(repo: &Repository) -> Option<GitWorktreeStatus> {
    if !repo.is_worktree() {
        return None;
    }
    // `commondir()` is the *shared* git directory (the main repo's `.git`),
    // as opposed to `repo.path()` which for a worktree is its own
    // `.git/worktrees/<name>` — its parent is the main repo's own folder.
    let main_repo_name = repo
        .commondir()
        .parent()
        .and_then(Path::file_name)
        .map(|name| name.to_string_lossy().into_owned())?;
    Some(GitWorktreeStatus { main_repo_name })
}

fn canonicalize_or_self(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

/// A `..`/segment relative path from `base` to `target` — the same shape
/// `git status` prints when run from a directory other than the repo root
/// (entries outside `base`'s own subtree get a `../`-prefixed path, entries
/// inside get a plain relative one). Forward-slash joined regardless of
/// platform, matching this module's own path convention.
fn path_diff(base: &Path, target: &Path) -> String {
    let base_components: Vec<_> = base.components().collect();
    let target_components: Vec<_> = target.components().collect();
    let common = base_components
        .iter()
        .zip(target_components.iter())
        .take_while(|(a, b)| a == b)
        .count();

    let mut parts: Vec<String> = Vec::new();
    for _ in common..base_components.len() {
        parts.push("..".to_string());
    }
    for component in &target_components[common..] {
        parts.push(component.as_os_str().to_string_lossy().into_owned());
    }
    parts.join("/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    /// A throwaway git repo under the system temp dir, removed by `drop`.
    /// Setup still shells out to the real `git` binary — that's test
    /// scaffolding independent of the production code under test here
    /// (which never shells out), the same convention the previous version of
    /// this module's tests already used.
    struct GitFixture(PathBuf);

    impl GitFixture {
        fn new(name: &str) -> Self {
            // nosemgrep: rust.lang.security.temp-dir.temp-dir -- test fixture scratch dir, not a security operation.
            let root = std::env::temp_dir()
                .join(format!("panecrew-git-status-{}-{name}", std::process::id()));
            std::fs::remove_dir_all(&root).ok();
            std::fs::create_dir_all(&root).expect("test fixture dir should be creatable");
            run(&root, &["init", "-q", "-b", "main"]);
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

        fn stage(&self, relative: &str) {
            run(&self.0, &["add", relative]);
        }

        fn commit_all(&self) {
            run(&self.0, &["add", "-A"]);
            run(&self.0, &["commit", "-q", "-m", "initial"]);
        }

        fn checkout_new_branch(&self, name: &str) {
            run(&self.0, &["checkout", "-q", "-b", name]);
        }

        fn checkout_detached(&self) {
            run(&self.0, &["checkout", "-q", "--detach", "HEAD"]);
        }

        fn root(&self) -> String {
            self.0.to_string_lossy().into_owned()
        }

        fn path(&self) -> &Path {
            &self.0
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

    fn states_for<'a>(status: &'a GitRepoStatus, path: &str) -> &'a [GitFileState] {
        status
            .files
            .iter()
            .find(|f| f.path == path)
            .map(|f| f.states.as_slice())
            .unwrap_or(&[])
    }

    #[test]
    fn a_directory_that_is_not_a_git_repo_reports_nothing() {
        // nosemgrep: rust.lang.security.temp-dir.temp-dir -- test fixture scratch dir, not a security operation.
        let root = std::env::temp_dir().join("panecrew-git-status-not-a-repo");
        std::fs::create_dir_all(&root).expect("plain dir should be creatable");

        let status = explorer_git_status(root.to_string_lossy().into_owned());

        assert!(status.files.is_empty());
        assert!(status.branch.is_none());
        assert!(status.worktree.is_none());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn reports_an_unstaged_modification() {
        let fixture = GitFixture::new("unstaged-mod");
        fixture.write("tracked.txt", "original\n");
        fixture.commit_all();
        fixture.write("tracked.txt", "changed\n");

        let status = explorer_git_status(fixture.root());

        assert_eq!(
            states_for(&status, "tracked.txt"),
            &[GitFileState::Unstaged]
        );
    }

    #[test]
    fn reports_a_staged_addition() {
        let fixture = GitFixture::new("staged-add");
        fixture.write("added.rs", "fn main() {}\n");
        fixture.stage("added.rs");

        let status = explorer_git_status(fixture.root());

        assert_eq!(states_for(&status, "added.rs"), &[GitFileState::Staged]);
    }

    #[test]
    fn reports_an_untracked_file() {
        let fixture = GitFixture::new("untracked");
        fixture.write("brand-new.txt", "new\n");

        let status = explorer_git_status(fixture.root());

        assert_eq!(
            states_for(&status, "brand-new.txt"),
            &[GitFileState::Untracked]
        );
    }

    #[test]
    fn reports_a_file_that_is_both_staged_and_further_unstaged_modified() {
        let fixture = GitFixture::new("staged-and-unstaged");
        fixture.write("both.txt", "one\n");
        fixture.commit_all();
        fixture.write("both.txt", "two\n");
        fixture.stage("both.txt");
        fixture.write("both.txt", "three\n");

        let status = explorer_git_status(fixture.root());

        let states = states_for(&status, "both.txt");
        assert!(states.contains(&GitFileState::Staged));
        assert!(states.contains(&GitFileState::Unstaged));
    }

    #[test]
    fn skips_a_deleted_file_since_no_tree_node_can_exist_for_it() {
        let fixture = GitFixture::new("deleted");
        fixture.write("gone.txt", "bye\n");
        fixture.commit_all();
        std::fs::remove_file(fixture.path().join("gone.txt")).expect("removable");

        let status = explorer_git_status(fixture.root());

        assert!(status.files.iter().all(|f| f.path != "gone.txt"));
    }

    #[test]
    fn takes_the_destination_path_of_a_rename_and_skips_the_origin() {
        let fixture = GitFixture::new("rename");
        fixture.write("old/path.rs", "content\n");
        fixture.commit_all();
        std::fs::create_dir_all(fixture.path().join("new")).expect("dir creatable");
        std::fs::rename(
            fixture.path().join("old/path.rs"),
            fixture.path().join("new/path.rs"),
        )
        .expect("renamable");
        fixture.stage("old/path.rs");
        fixture.stage("new/path.rs");

        let status = explorer_git_status(fixture.root());

        assert!(status.files.iter().all(|f| f.path != "old/path.rs"));
        assert_eq!(states_for(&status, "new/path.rs"), &[GitFileState::Staged]);
    }

    #[test]
    fn caps_the_result_instead_of_returning_an_unbounded_list() {
        let fixture = GitFixture::new("cap");
        for index in 0..(MAX_ENTRIES + 10) {
            fixture.write(&format!("file{index}.txt"), "x\n");
        }

        let status = explorer_git_status(fixture.root());

        assert_eq!(status.files.len(), MAX_ENTRIES);
    }

    #[test]
    fn reports_the_current_branch_name() {
        let fixture = GitFixture::new("branch-name");
        fixture.write("f.txt", "x\n");
        fixture.commit_all();
        fixture.checkout_new_branch("feature/git-integration");

        let status = explorer_git_status(fixture.root());

        let branch = status.branch.expect("real repo always has branch info");
        assert_eq!(branch.name.as_deref(), Some("feature/git-integration"));
        assert!(!branch.detached);
    }

    #[test]
    fn reports_a_symbolic_branch_name_even_before_the_first_commit() {
        let fixture = GitFixture::new("unborn");

        let status = explorer_git_status(fixture.root());

        let branch = status.branch.expect("even an unborn HEAD has branch info");
        assert_eq!(branch.name.as_deref(), Some("main"));
        assert!(!branch.detached);
    }

    #[test]
    fn reports_a_detached_head_without_crashing() {
        let fixture = GitFixture::new("detached");
        fixture.write("f.txt", "x\n");
        fixture.commit_all();
        fixture.checkout_detached();

        let status = explorer_git_status(fixture.root());

        let branch = status.branch.expect("real repo always has branch info");
        assert!(branch.detached);
        assert_eq!(branch.name, None);
        assert_eq!(branch.ahead, None);
        assert_eq!(branch.behind, None);
    }

    #[test]
    fn reports_no_ahead_behind_without_a_configured_upstream() {
        let fixture = GitFixture::new("no-upstream");
        fixture.write("f.txt", "x\n");
        fixture.commit_all();

        let status = explorer_git_status(fixture.root());

        let branch = status.branch.expect("real repo always has branch info");
        assert_eq!(branch.ahead, None);
        assert_eq!(branch.behind, None);
    }

    #[test]
    fn reports_ahead_and_behind_against_the_configured_upstream() {
        // A bare "remote" plus a clone gives us a real upstream-tracking
        // branch without any network access.
        // nosemgrep: rust.lang.security.temp-dir.temp-dir -- test fixture scratch dir, not a security operation.
        let remote_root = std::env::temp_dir().join(format!(
            "panecrew-git-status-{}-ahead-behind-remote",
            std::process::id()
        ));
        std::fs::remove_dir_all(&remote_root).ok();
        std::fs::create_dir_all(&remote_root).expect("creatable");
        run(&remote_root, &["init", "-q", "--bare", "-b", "main"]);

        let origin = GitFixture::new("ahead-behind-origin");
        run(
            origin.path(),
            &["remote", "add", "origin", &remote_root.to_string_lossy()],
        );
        origin.write("f.txt", "one\n");
        origin.commit_all();
        run(origin.path(), &["push", "-q", "-u", "origin", "main"]);

        // nosemgrep: rust.lang.security.temp-dir.temp-dir -- test fixture scratch dir, not a security operation.
        let clone_root = std::env::temp_dir().join(format!(
            "panecrew-git-status-{}-ahead-behind-clone",
            std::process::id()
        ));
        std::fs::remove_dir_all(&clone_root).ok();
        run(
            Path::new("."),
            &[
                "clone",
                "-q",
                &remote_root.to_string_lossy(),
                &clone_root.to_string_lossy(),
            ],
        );
        run(
            &clone_root,
            &["config", "user.email", "test@panecrew.local"],
        );
        run(&clone_root, &["config", "user.name", "PaneCrew Test"]);

        // The clone gets one commit the origin doesn't have (ahead 1); the
        // origin gets one more the clone hasn't fetched (behind 1 once
        // fetched).
        std::fs::write(clone_root.join("clone-only.txt"), "x\n").expect("writable");
        run(&clone_root, &["add", "-A"]);
        run(&clone_root, &["commit", "-q", "-m", "clone-only"]);

        origin.write("origin-only.txt", "y\n");
        origin.commit_all();
        run(origin.path(), &["push", "-q", "origin", "main"]);
        run(&clone_root, &["fetch", "-q"]);

        let status = explorer_git_status(clone_root.to_string_lossy().into_owned());

        let branch = status.branch.expect("real repo always has branch info");
        assert_eq!(branch.ahead, Some(1));
        assert_eq!(branch.behind, Some(1));

        std::fs::remove_dir_all(&remote_root).ok();
        std::fs::remove_dir_all(&clone_root).ok();
    }

    #[test]
    fn detects_no_worktree_for_a_plain_repo() {
        let fixture = GitFixture::new("plain-not-worktree");
        fixture.write("f.txt", "x\n");
        fixture.commit_all();

        let status = explorer_git_status(fixture.root());

        assert!(status.worktree.is_none());
    }

    #[test]
    fn detects_a_linked_worktree_and_names_the_main_repo() {
        let fixture = GitFixture::new("worktree-main");
        fixture.write("f.txt", "x\n");
        fixture.commit_all();
        // nosemgrep: rust.lang.security.temp-dir.temp-dir -- test fixture scratch dir, not a security operation.
        let worktree_path = std::env::temp_dir().join(format!(
            "panecrew-git-status-{}-worktree-linked",
            std::process::id()
        ));
        std::fs::remove_dir_all(&worktree_path).ok();
        run(
            fixture.path(),
            &[
                "worktree",
                "add",
                "-q",
                "-b",
                "wt-branch",
                &worktree_path.to_string_lossy(),
            ],
        );

        let status = explorer_git_status(worktree_path.to_string_lossy().into_owned());

        let worktree = status.worktree.expect("linked worktree should be detected");
        let main_repo_name = fixture
            .path()
            .file_name()
            .expect("fixture has a name")
            .to_string_lossy()
            .into_owned();
        assert_eq!(worktree.main_repo_name, main_repo_name);
        let branch = status.branch.expect("worktree still has branch info");
        assert_eq!(branch.name.as_deref(), Some("wt-branch"));

        std::fs::remove_dir_all(&worktree_path).ok();
    }

    #[test]
    fn reports_real_modified_and_untracked_files_from_an_actual_repo() {
        let fixture = GitFixture::new("live");
        fixture.write("tracked.txt", "original\n");
        fixture.commit_all();
        fixture.write("tracked.txt", "changed\n");
        fixture.write("brand-new.txt", "new\n");

        let status = explorer_git_status(fixture.root());
        let mut paths: Vec<_> = status.files.iter().map(|f| f.path.clone()).collect();
        paths.sort();

        assert_eq!(paths, vec!["brand-new.txt", "tracked.txt"]);
        assert_eq!(
            states_for(&status, "tracked.txt"),
            &[GitFileState::Unstaged]
        );
        assert_eq!(
            states_for(&status, "brand-new.txt"),
            &[GitFileState::Untracked]
        );
    }

    #[test]
    fn paths_outside_a_nested_root_carry_a_relative_prefix_like_real_git_status() {
        let fixture = GitFixture::new("nested-root");
        fixture.write("outer.txt", "one\n");
        fixture.write("sub/inner.txt", "two\n");
        fixture.commit_all();
        fixture.write("outer.txt", "changed\n");
        fixture.write("sub/inner.txt", "changed too\n");

        // Opening the SUBDIRECTORY as the project root, not the repo root —
        // the same situation `git -C sub status` would report against.
        let nested_root = fixture.path().join("sub").to_string_lossy().into_owned();
        let status = explorer_git_status(nested_root);

        assert_eq!(states_for(&status, "inner.txt"), &[GitFileState::Unstaged]);
        assert_eq!(
            states_for(&status, "../outer.txt"),
            &[GitFileState::Unstaged]
        );
    }
}
