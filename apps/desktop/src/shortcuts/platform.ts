// Welcher Primärmodifikator gilt — Cmd auf macOS, sonst Strg. Bewusst nicht
// `navigator.platform` (deprecated) und nicht `userAgentData` (im WKWebView
// nicht vorhanden): der User-Agent-String trägt die Kennung auf allen
// Zielplattformen und braucht keine Typ-Erweiterung.
export function isMacPlatform(): boolean {
  return navigator.userAgent.includes("Mac");
}
