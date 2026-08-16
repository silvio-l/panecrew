fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        // tauri-build's default Windows app manifest (Common Controls v6 —
        // needed by WebView2/dialogs) is only linked into `[[bin]]` targets;
        // the synthetic binary `cargo test` builds for `--lib` never gets
        // it, resolves comctl32.dll to the old System32 copy, and crashes
        // at startup with STATUS_ENTRYPOINT_NOT_FOUND. Cargo has no linker
        // directive that reaches the lib's own unit-test harness without
        // also reaching bins (`cargo:rustc-link-arg-tests=` doesn't reach
        // it; the unqualified `cargo:rustc-link-arg=` does, but then
        // reaches bins too) — so instead of letting tauri-build embed its
        // own manifest (bins only) *and* adding a second, separate one for
        // tests (both claim resource ID 1 → CVTRES "Doppelte Ressource"),
        // disable tauri-build's manifest embedding and supply the same
        // manifest ourselves, linked into every target uniformly.
        tauri_build::try_build(
            tauri_build::Attributes::new()
                .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest()),
        )
        .expect("tauri_build failed");
        embed_resource::compile_for_everything("windows-app-manifest.rc", embed_resource::NONE)
            .manifest_required()
            .unwrap();
    } else {
        tauri_build::build();
    }
}
