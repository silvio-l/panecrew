// App-weite Kontextmenü-Politik (2026-08-13, Nutzer-Entscheidung): "Ich
// möchte nur ein Kontextmenü da haben, wo wir selbst ein Kontextmenü haben
// wollen. Also nicht überall in der App. Es sollte überall grundsätzlich
// erstmal deaktiviert sein." Das native Kontextmenü des Webviews (Tauri/
// WKWebView) existiert damit nirgends mehr von selbst — nur die Stellen, an
// denen die App per Radix `ContextMenu` bewusst ein eigenes einrichtet
// (`PaneTabs.tsx`, `ExplorerPanel.tsx`, `TerminalPane.tsx`), bleiben bedienbar.
//
// EIN `contextmenu`-Listener auf `window`, statt je Fenster-Entry-Point
// wiederholt inline — dasselbe Muster wie `initThemeApplier()`, aufgerufen in
// jedem der drei Entry-Points (`main.tsx`, `about/main.tsx`,
// `settings/main.tsx`), weil jedes Tauri-Fenster sein eigenes, unabhängiges
// Webview samt eigenem `window` ist.
//
// Kollidiert nicht mit den bestehenden Radix-Kontextmenüs: React hängt seine
// synthetischen `onContextMenu`-Handler (darunter Radix' eigenes
// `preventDefault` + Öffnen-Logik) an einen Knoten INNERHALB von `window`,
// das native Ereignis erreicht diesen Handler beim Bubbling also zuerst,
// diesen Listener hier erst danach — `preventDefault()` ein zweites Mal ist
// wirkungslos, Radix' Menü öffnet unabhängig vom nativen Default-Verhalten.
export function installNativeContextMenuPolicy(): void {
  window.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });
}
