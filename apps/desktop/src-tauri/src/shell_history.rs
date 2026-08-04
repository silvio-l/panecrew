//! Read-only access to the user's own shell history file, for the terminal's
//! inline suggestions.
//!
//! This lives in Rust rather than the webview because the webview has no
//! filesystem access at all in this app: reading `~/.zsh_history` from there
//! would mean adding `plugin-fs` with a `$HOME`-wide scope — a far broader
//! grant than one read of one well-known path. Nothing here ever writes: the
//! user's history file is theirs, and a terminal that edits it would be a
//! surprise nobody asked for.

use std::path::{Path, PathBuf};

/// Enough for prefix matching to feel complete without shipping a multi-megabyte
/// payload over IPC on every app start.
const MAX_ENTRIES: usize = 1000;

#[tauri::command]
pub fn shell_history_read() -> Vec<String> {
    let Some(path) = history_path(&crate::pty_manager::default_shell()) else {
        return Vec::new();
    };
    let Ok(bytes) = std::fs::read(path) else {
        return Vec::new();
    };
    // Lossy on purpose: zsh "metafies" some bytes when writing its history, so
    // the file is not guaranteed to be valid UTF-8. A single unreadable entry
    // must not cost us the other thousand.
    parse_history(&String::from_utf8_lossy(&bytes), MAX_ENTRIES)
}

fn home_dir() -> Option<PathBuf> {
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
