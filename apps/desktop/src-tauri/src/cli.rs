//! Command-line surface for launching PaneCrew directly into a project,
//! skipping the picker. Doc comments here are the single source for three
//! things at once: `--help`, the man-page-style reference generated into
//! `docs/cli.md` (via `cargo run --example gen-cli-docs`), and this file —
//! change the comment, regenerate, never hand-edit the generated doc.

use std::path::PathBuf;

use clap::Parser;

/// PaneCrew — a grid of live terminal panes with a focus-following file
/// explorer.
///
/// No explicit `name` override here: the compiled binary is currently called
/// `desktop` (the Cargo package name, matching the `apps/desktop` scaffold
/// folder), not `panecrew` — the project's brand guidelines want the eventual CLI
/// binary to be lowercase `panecrew`, but renaming it is its own separate,
/// larger decision (Cargo package rename + `tauri.conf.json`'s
/// `mainBinaryName`), not something to fold into this doc silently. Leaving
/// `name` unset makes clap fall back to `CARGO_PKG_NAME`, so `--help`,
/// `--version`, and the generated `docs/cli.md` all say the command a user
/// can actually type today rather than a name that doesn't run yet.
#[derive(Parser, Debug, Clone, PartialEq, Eq)]
#[command(version, about, long_about = None)]
pub struct Cli {
    /// Open directly with this project instead of showing the project picker.
    ///
    /// Resolved against the current shell's working directory if relative.
    /// A `~` is expanded by your shell before PaneCrew ever sees it; if the
    /// path doesn't exist or isn't a directory, PaneCrew falls back to the
    /// picker rather than failing to start.
    #[arg(value_name = "PROJECT_PATH")]
    pub project: Option<PathBuf>,
}

impl Cli {
    /// Parses `argv`, ignoring `argv[0]` (the executable path) like
    /// [`clap::Parser::parse`] does — kept as a thin wrapper so `main.rs`
    /// doesn't reach into clap directly and so this is testable without a
    /// real process's `std::env::args()`.
    pub fn parse_args<I, T>(argv: I) -> Self
    where
        I: IntoIterator<Item = T>,
        T: Into<std::ffi::OsString> + Clone,
    {
        Self::parse_from(argv)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_arguments_leaves_project_unset() {
        let cli = Cli::parse_args(["panecrew"]);
        assert_eq!(cli.project, None);
    }

    #[test]
    fn a_bare_positional_argument_is_the_project_path() {
        let cli = Cli::parse_args(["panecrew", "/Users/dev/storefront"]);
        assert_eq!(cli.project, Some(PathBuf::from("/Users/dev/storefront")));
    }

    #[test]
    fn a_relative_path_is_kept_relative_for_the_caller_to_resolve() {
        let cli = Cli::parse_args(["panecrew", "../storefront"]);
        assert_eq!(cli.project, Some(PathBuf::from("../storefront")));
    }
}
