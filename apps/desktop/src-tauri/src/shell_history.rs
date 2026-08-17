//! Read-only access to the user's own shell history file, for the terminal's
//! inline suggestions.
//!
//! This lives in Rust rather than the webview because the webview has no
//! filesystem access at all in this app: reading `~/.zsh_history` from there
//! would mean adding `plugin-fs` with a `$HOME`-wide scope — a far broader
//! grant than one read of one well-known path. Nothing here ever writes: the
//! user's history file is theirs, and a terminal that edits it would be a
//! surprise nobody asked for.

use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// Enough for prefix matching to feel complete without shipping a multi-megabyte
/// payload over IPC on every app start.
const MAX_ENTRIES: usize = 1000;

/// Starting size of the tail read in `read_history_file` (Ticket 14, perf
/// audit) — at typical shell history line lengths, `MAX_ENTRIES` (1000)
/// lines comfortably fits within this many bytes, so the common case is one
/// single read from the end of the file, not the whole file however large
/// it's grown over the years.
const TAIL_WINDOW_SEED: u64 = 64 * 1024;

// `async`: same reasoning as `explorer_fs.rs::explorer_read_tree` — a
// history file can grow large, and a file read must not run on the thread
// that dispatches IPC.
#[tauri::command(async)]
pub fn shell_history_read() -> Vec<String> {
    let Some(path) = history_path(&crate::pty_manager::default_shell()) else {
        return Vec::new();
    };
    read_history_file(&path, MAX_ENTRIES)
}

/// Reads only as much of the tail of `path` as needed to satisfy `limit`
/// distinct entries, growing the read window (doubling from
/// `TAIL_WINDOW_SEED`) instead of loading and parsing the entire file up
/// front. A window's leading line is dropped unless it starts at the true
/// beginning of the file — it's the truncated tail of whatever line preceded
/// the window, not a full one.
///
/// Known, narrow trade-off: if a window boundary happens to land inside a
/// backslash-continued multi-line command (see `parse_history`'s doc
/// comment), that one boundary-adjacent entry can come out mis-parsed. In
/// practice this only risks the single oldest entry of a result that already
/// found `>= limit` distinct entries elsewhere in the window, and multi-line
/// continuations are rare in real shell history — accepted here rather than
/// building a full backward-aware continuation parser for a Low-severity,
/// read-only autocomplete data source.
fn read_history_file(path: &Path, limit: usize) -> Vec<String> {
    let Ok(mut file) = std::fs::File::open(path) else {
        return Vec::new();
    };
    let Ok(file_len) = file.metadata().map(|meta| meta.len()) else {
        return Vec::new();
    };

    let mut window = TAIL_WINDOW_SEED.min(file_len);
    loop {
        let at_start = window >= file_len;
        let Ok(chunk) = read_tail(&mut file, file_len, window) else {
            return Vec::new();
        };
        let text = String::from_utf8_lossy(&chunk);
        let tail = if at_start {
            text
        } else {
            match text.find('\n') {
                Some(index) => std::borrow::Cow::Owned(text[index + 1..].to_owned()),
                None => std::borrow::Cow::Borrowed(""),
            }
        };

        let entries = parse_history(&tail, limit);
        if entries.len() >= limit || at_start {
            return entries;
        }
        window = (window * 2).min(file_len);
    }
}

fn read_tail(file: &mut std::fs::File, file_len: u64, window: u64) -> std::io::Result<Vec<u8>> {
    file.seek(SeekFrom::Start(file_len - window))?;
    let mut buf = vec![0u8; window as usize];
    file.read_exact(&mut buf)?;
    Ok(buf)
}

pub(crate) fn home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    let home = std::env::var_os("USERPROFILE");
    #[cfg(not(windows))]
    let home = std::env::var_os("HOME");
    home.map(PathBuf::from)
}

/// `None` for shells whose history we can't read (cmd.exe keeps none on disk),
/// which degrades to suggestions from the current session only.
fn history_path(shell: &str) -> Option<PathBuf> {
    let name = Path::new(shell).file_name()?.to_string_lossy().into_owned();
    let file = if name.contains("zsh") {
        ".zsh_history"
    } else if name.contains("bash") {
        ".bash_history"
    } else {
        return None;
    };
    Some(home_dir()?.join(file))
}

/// History entries, most recent first and deduplicated.
///
/// Handles both on-disk formats we read: bash writes bare command lines (plus
/// `#<timestamp>` comment lines when `HISTTIMEFORMAT` is set), zsh prefixes
/// each entry with `: <started>:<elapsed>;` under `EXTENDED_HISTORY` and
/// continues a multi-line command with a trailing backslash.
fn parse_history(raw: &str, limit: usize) -> Vec<String> {
    let mut entries: Vec<String> = Vec::new();
    let mut pending: Option<String> = None;

    for line in raw.lines() {
        let (text, continues) = match line.strip_suffix('\\') {
            // An even number of trailing backslashes is an escaped backslash,
            // not a line continuation.
            Some(head) if trailing_backslashes(line) % 2 == 1 => (head, true),
            _ => (line, false),
        };

        let text = match pending.take() {
            Some(started) => format!("{started}\n{text}"),
            None => strip_zsh_metadata(text).to_owned(),
        };

        if continues {
            pending = Some(text);
        } else if !text.trim().is_empty() && !text.starts_with('#') {
            entries.push(text);
        }
    }
    if let Some(text) = pending {
        if !text.trim().is_empty() {
            entries.push(text);
        }
    }

    let mut seen = std::collections::HashSet::new();
    entries
        .into_iter()
        .rev()
        .filter(|entry| seen.insert(entry.clone()))
        .take(limit)
        .collect()
}

fn trailing_backslashes(line: &str) -> usize {
    line.bytes().rev().take_while(|byte| *byte == b'\\').count()
}

/// Strips zsh's `: <started>:<elapsed>;` prefix, leaving anything else alone —
/// including a command that merely happens to start with a colon.
fn strip_zsh_metadata(line: &str) -> &str {
    let Some(rest) = line.strip_prefix(": ") else {
        return line;
    };
    let Some((timestamps, command)) = rest.split_once(';') else {
        return line;
    };
    match timestamps.split_once(':') {
        Some((started, elapsed))
            if !started.is_empty()
                && !elapsed.is_empty()
                && started.bytes().all(|b| b.is_ascii_digit())
                && elapsed.bytes().all(|b| b.is_ascii_digit()) =>
        {
            command
        }
        _ => line,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A throwaway history file under the system temp dir, removed by `drop`
    /// — same shape as `explorer_fs.rs`'s own `Fixture`.
    struct Fixture(std::path::PathBuf);

    impl Fixture {
        fn new(name: &str) -> Self {
            // nosemgrep: rust.lang.security.temp-dir.temp-dir -- test fixture scratch dir, not a security operation.
            let root = std::env::temp_dir().join(format!(
                "panecrew-shell-history-{}-{name}",
                std::process::id()
            ));
            std::fs::create_dir_all(&root).expect("test fixture root should be creatable");
            Self(root)
        }

        fn write_history(&self, contents: &str) -> PathBuf {
            let path = self.0.join("history_file");
            std::fs::write(&path, contents).expect("write fixture history file");
            path
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.0).ok();
        }
    }

    /// Ticket 14 (perf audit): a file far bigger than the configured limit —
    /// 20,000 single-line entries, ~230KB — forces `read_history_file` past
    /// its initial tail-read window (`TAIL_WINDOW_SEED`, 64KB) at least once,
    /// so this exercises the growing-window path, not just a single read
    /// that already happened to be big enough.
    #[test]
    fn reading_a_history_file_far_larger_than_the_limit_still_returns_the_correct_newest_entries()
    {
        let fixture = Fixture::new("large-file-forces-growth");
        let mut raw = String::new();
        for i in 0..20_000 {
            raw.push_str(&format!("command-{i}\n"));
        }
        let path = fixture.write_history(&raw);

        // limit=6000 exceeds what a single 64KB window holds (~5000 lines at
        // this fixture's line length) — the result must still be correct,
        // not merely "whatever the first window happened to contain".
        let entries = read_history_file(&path, 6000);

        let expected: Vec<String> = (14_000..20_000).rev().map(|i| format!("command-{i}")).collect();
        assert_eq!(entries.len(), 6000);
        assert_eq!(entries, expected);
    }

    /// The common case: a file smaller than the tail window is read whole in
    /// one pass (the `at_start` branch), same as before this ticket.
    #[test]
    fn reading_a_small_history_file_returns_every_entry_newest_first() {
        let fixture = Fixture::new("small-file");
        let path = fixture.write_history("git status\nls\ngit status\npnpm test\n");

        let entries = read_history_file(&path, 10);

        // Dedup keeps the MORE RECENT occurrence of "git status" (the third
        // line), so the earlier one drops out entirely — same behavior as
        // `parse_history` on its own, see
        // `returns_most_recent_first_and_deduplicated` above.
        assert_eq!(entries, vec!["pnpm test", "git status", "ls"]);
    }

    /// A history file that doesn't exist at all (fresh install, no shell
    /// history yet) degrades to an empty suggestion list rather than erroring.
    #[test]
    fn a_missing_history_file_returns_no_entries() {
        let fixture = Fixture::new("missing-file");
        let path = fixture.0.join("does-not-exist");

        assert_eq!(read_history_file(&path, 10), Vec::<String>::new());
    }

    #[test]
    fn returns_most_recent_first_and_deduplicated() {
        let parsed = parse_history("git status\nls\ngit status\n", 10);

        assert_eq!(parsed, vec!["git status", "ls"]);
    }

    #[test]
    fn strips_the_zsh_extended_history_prefix() {
        let parsed = parse_history(": 1754300000:0;pnpm test\n", 10);

        assert_eq!(parsed, vec!["pnpm test"]);
    }

    #[test]
    fn keeps_a_command_that_only_looks_like_a_zsh_prefix() {
        // A real command, not metadata — the timestamps aren't numeric.
        let parsed = parse_history(": not:stamps;echo hi\n", 10);

        assert_eq!(parsed, vec![": not:stamps;echo hi"]);
    }

    #[test]
    fn joins_a_backslash_continued_command_into_one_entry() {
        let raw = ": 1754300000:0;for f in *; do \\\necho $f \\\ndone\n";

        let parsed = parse_history(raw, 10);

        assert_eq!(parsed, vec!["for f in *; do \necho $f \ndone"]);
    }

    #[test]
    fn treats_an_escaped_backslash_as_the_end_of_an_entry() {
        let parsed = parse_history("printf a\\\\\nls\n", 10);

        assert_eq!(parsed, vec!["ls", "printf a\\\\"]);
    }

    #[test]
    fn skips_bash_timestamp_comments_and_blank_lines() {
        let parsed = parse_history("#1754300000\n\nls -la\n", 10);

        assert_eq!(parsed, vec!["ls -la"]);
    }

    #[test]
    fn caps_the_result_at_the_limit_keeping_the_newest() {
        let parsed = parse_history("a\nb\nc\n", 2);

        assert_eq!(parsed, vec!["c", "b"]);
    }

    #[test]
    fn has_no_history_path_for_a_shell_without_a_readable_one() {
        assert!(history_path("/bin/cmd.exe").is_none());
        assert!(history_path("/usr/local/bin/fish").is_none());
    }
}
