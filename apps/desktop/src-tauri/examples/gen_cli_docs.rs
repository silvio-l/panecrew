//! Regenerates `docs/cli.md` from the `Cli` struct in `src/cli.rs` — the same
//! doc comments that drive `--help`, so the reference and the flag can't
//! drift apart. Run via `cargo run --example gen_cli_docs` from
//! `apps/desktop/src-tauri`, then commit the result; this only prints to
//! stdout, it does not write the file itself.

fn main() {
    print!(
        "{}",
        clap_markdown::help_markdown::<desktop_lib::cli::Cli>()
    );
}
