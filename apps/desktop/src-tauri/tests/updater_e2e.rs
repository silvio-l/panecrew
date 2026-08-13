// E2E-Verifikation für Ticket 30 (Auto-Update): beweist, dass der reale
// Ed25519/minisign-Signaturpfad aus `tauri-plugin-updater` PaneCrews eigene
// Pubkey-Konfiguration korrekt akzeptiert (gültige Signatur) UND korrekt
// abweist (manipulierte Signatur) — nicht mit einer selbstgebauten
// minisign-Nachbildung, sondern mit der echten `tauri signer sign`-CLI, die
// auch die Release-Pipeline benutzt, und der echten `download()`-Prüfung des
// Plugins. `check()` allein würde das nicht zeigen: die Signaturprüfung
// passiert erst in `download()`, s. updater.rs `verify_signature`.
//
// `#[ignore]`, weil es ein lokales Test-Schlüsselpaar braucht (nie im Repo):
// `PANECREW_UPDATER_E2E_KEY` auf den privaten Schlüsselpfad setzen (die
// `.pub`-Datei muss daneben liegen) und mit `--ignored` laufen lassen:
//   PANECREW_UPDATER_E2E_KEY=~/.tauri/panecrew-dev-test.key \
//     cargo test --test updater_e2e -- --ignored
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    process::Command,
    thread,
};

use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri_plugin_updater::UpdaterExt;

fn key_path_from_env() -> Option<PathBuf> {
    std::env::var("PANECREW_UPDATER_E2E_KEY")
        .ok()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
}

/// Bindet sofort einen freien lokalen Port (damit der Aufrufer ihn schon in
/// die `latest.json`-URLs einsetzen kann) und startet den eigentlichen
/// Ein-Antwort-pro-Verbindung-Server erst danach in einem Hintergrundthread
/// — keine neue HTTP-Server-Abhängigkeit nur für einen `#[ignore]`d Test.
fn bind_local_server() -> (u16, TcpListener) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("lokalen Testserver binden");
    let port = listener.local_addr().unwrap().port();
    (port, listener)
}

fn serve(listener: TcpListener, latest_json: Vec<u8>, artifact: Vec<u8>) {
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            respond(&mut stream, &latest_json, &artifact);
        }
    });
}

fn respond(stream: &mut TcpStream, latest_json: &[u8], artifact: &[u8]) {
    let mut buf = [0u8; 8192];
    let n = match stream.read(&mut buf) {
        Ok(n) => n,
        Err(_) => return,
    };
    let request = String::from_utf8_lossy(&buf[..n]);
    let path = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or("/");

    let (content_type, body): (&str, &[u8]) = match path {
        "/latest.json" => ("application/json", latest_json),
        "/artifact.tar.gz" => ("application/octet-stream", artifact),
        _ => {
            let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
            return;
        }
    };
    let header = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(body);
}

/// Signiert `file` mit derselben CLI, die auch die echte Release-Pipeline
/// benutzt (`pnpm tauri signer sign`), und liefert den Inhalt der erzeugten
/// `.sig`-Datei — die CLI schreibt dort bereits die base64-kodierte Form,
/// exakt das Format, das `latest.json`s `signature`-Feld laut
/// `verify_signature` erwartet (kein weiteres base64 mehr nötig).
fn sign_with_real_cli(file: &std::path::Path, key_path: &std::path::Path) -> String {
    let desktop_dir = concat!(env!("CARGO_MANIFEST_DIR"), "/..");
    let status = Command::new("pnpm")
        .args(["tauri", "signer", "sign", "-f"])
        .arg(key_path)
        .args(["-p", ""])
        .arg(file)
        .current_dir(desktop_dir)
        .status()
        .expect("`pnpm tauri signer sign` ausführen (setzt `pnpm install` voraus)");
    assert!(status.success(), "tauri signer sign ist fehlgeschlagen");

    let sig_path = PathBuf::from(format!("{}.sig", file.display()));
    std::fs::read_to_string(&sig_path)
        .expect("erzeugte .sig-Datei lesen")
        .trim()
        .to_string()
}

#[tokio::test]
#[ignore = "braucht ein lokales minisign-Testschlüsselpaar, s. Dateikommentar"]
async fn download_verifies_real_signature_and_rejects_tampering() {
    let Some(key_path) = key_path_from_env() else {
        eprintln!("übersprungen: PANECREW_UPDATER_E2E_KEY ist nicht gesetzt");
        return;
    };
    let pubkey_path = PathBuf::from(format!("{}.pub", key_path.display()));
    let pubkey = std::fs::read_to_string(&pubkey_path)
        .unwrap_or_else(|e| panic!("öffentlichen Testschlüssel {pubkey_path:?} lesen: {e}"));

    let tmp_dir = std::env::temp_dir().join(format!("panecrew-updater-e2e-{}", std::process::id()));
    std::fs::create_dir_all(&tmp_dir).unwrap();
    let artifact_path = tmp_dir.join("artifact.tar.gz");
    let artifact_bytes = b"panecrew e2e test artifact - inhalt ist fuer die signaturpruefung irrelevant".to_vec();
    std::fs::write(&artifact_path, &artifact_bytes).unwrap();

    let valid_signature = sign_with_real_cli(&artifact_path, &key_path);

    // Eine gekippte Stelle mitten in der äußeren Base64 reicht: je nach
    // Byte-Offset schlägt entweder schon die UTF8-Dekodierung des inneren
    // minisign-Blocks fehl oder erst die Ed25519-Prüfung — beides ist ein
    // `Err` aus `download()`, und genau das soll dieser Test zeigen.
    let mut tampered_chars: Vec<char> = valid_signature.chars().collect();
    let mid = tampered_chars.len() / 2;
    tampered_chars[mid] = if tampered_chars[mid] == 'A' { 'B' } else { 'A' };
    let tampered_signature: String = tampered_chars.into_iter().collect();

    let (port, listener) = bind_local_server();
    let latest_json = serde_json::to_vec(&serde_json::json!({
        "version": "0.1.1",
        "notes": "e2e test release",
        "pub_date": "2026-08-13T00:00:00Z",
        "platforms": {
            "valid": {
                "url": format!("http://127.0.0.1:{port}/artifact.tar.gz"),
                "signature": valid_signature,
            },
            "tampered": {
                "url": format!("http://127.0.0.1:{port}/artifact.tar.gz"),
                "signature": tampered_signature,
            },
        },
    }))
    .unwrap();
    serve(listener, latest_json, artifact_bytes.clone());

    // `mock_context()` liefert kein `plugins.updater`-Konfigurationsobjekt
    // (fehlender Schlüssel -> `serde_json::Value::Null`), das Plugin
    // verlangt aber ein deserialisierbares Objekt, auch wenn Pubkey und
    // Endpoints gleich danach per Builder überschrieben werden.
    let mut context = mock_context(noop_assets());
    context
        .config_mut()
        .plugins
        .0
        .insert("updater".to_string(), serde_json::json!({ "pubkey": "" }));

    let app = mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)
        .expect("Mock-App mit Updater-Plugin bauen");

    let endpoint: tauri::Url = format!("http://127.0.0.1:{port}/latest.json")
        .parse()
        .unwrap();

    let valid_updater = app
        .updater_builder()
        .pubkey(pubkey.clone())
        .endpoints(vec![endpoint.clone()])
        .expect("http-Endpoint im Debug-Build zulässig")
        .target("valid")
        .build()
        .expect("Updater bauen");

    let update = valid_updater
        .check()
        .await
        .expect("check() gegen den lokalen Server")
        .expect("0.1.1 muss als Update über 0.1.0 erkannt werden");
    assert_eq!(update.version, "0.1.1");

    let downloaded = update
        .download(|_, _| {}, || {})
        .await
        .expect("gültige Signatur muss die Verifikation bestehen");
    assert_eq!(downloaded, artifact_bytes);

    let tampered_updater = app
        .updater_builder()
        .pubkey(pubkey)
        .endpoints(vec![endpoint])
        .expect("http-Endpoint im Debug-Build zulässig")
        .target("tampered")
        .build()
        .expect("Updater bauen");

    let tampered_update = tampered_updater
        .check()
        .await
        .expect("check() gegen den lokalen Server")
        .expect("0.1.1 muss auch für den tampered-Zweig als Update erkannt werden");

    let result = tampered_update.download(|_, _| {}, || {}).await;
    assert!(
        result.is_err(),
        "eine manipulierte Signatur darf download() nicht bestehen"
    );
}
