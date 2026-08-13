use std::path::Path;

/// Homebrew Cask installiert die `.app` als echte Kopie direkt nach
/// `/Applications` — ein Pfad-Check auf den Installationsort selbst
/// unterscheidet eine Cask-Installation deshalb NICHT von einer manuell
/// heruntergeladenen. Homebrew hinterlegt aber zusätzlich einen eigenen
/// Caskroom-Eintrag außerhalb von `/Applications`, unabhängig davon, wo die
/// `.app` liegt — dessen Existenz ist der zuverlässige Marker.
const CASK_TOKENS: [&str; 2] = ["panecrew", "panecrew-nightly"];
const CASKROOM_ROOTS: [&str; 2] = ["/opt/homebrew/Caskroom", "/usr/local/Caskroom"];

#[tauri::command]
pub fn updater_is_homebrew_install() -> bool {
    is_homebrew_install()
}

fn is_homebrew_install() -> bool {
    CASKROOM_ROOTS.iter().any(|root| {
        CASK_TOKENS
            .iter()
            .any(|token| Path::new(root).join(token).is_dir())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caskroom_lookup_uses_both_known_roots_and_tokens() {
        // Reines Konstanten-Konsistenzprüfung — ein echter Homebrew-Caskroom
        // lässt sich in einem Unit-Test nicht herstellen, ohne das
        // Dateisystem zu verlassen.
        assert!(CASKROOM_ROOTS.contains(&"/opt/homebrew/Caskroom"));
        assert!(CASK_TOKENS.contains(&"panecrew"));
    }
}
