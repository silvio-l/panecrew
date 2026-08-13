import React from "react";
import ReactDOM from "react-dom/client";
import "../i18n";
import "../App.css";
import { installNativeContextMenuPolicy } from "../chrome/nativeContextMenuPolicy";
import { HarnessApp } from "./HarnessApp";
import { parseStoryboard, type Storyboard } from "./storyboard";

// Derselbe Grund wie in main.tsx/about/main.tsx/settings/main.tsx: der
// Harness läuft für Promo-Aufnahmen in einem Chrome-Kiosk-Fenster, das die
// echte App vortäuschen soll (tools/promo-pipeline/capture.py) — ein
// versehentlicher Rechtsklick auf freie Fläche dürfte dabei nicht Chromes
// eigenes Kontextmenü ("Neu laden", "Untersuchen" …) einblenden und ins
// Video geraten lassen.
installNativeContextMenuPolicy();

// Zweiter Vite-Einstieg neben `main.tsx`/`about/main.tsx` — absichtlich NICHT
// in vite.config.ts' `build.rollupOptions.input` eingetragen (ADR-0001):
// `vite build` (über `pnpm tauri build`) bündelt nur, was dort steht, dieser
// Einstieg ist also nie Teil des Produktions-Bundles, obwohl der Vite-
// Dev-Server (`pnpm tauri dev`) ihn unter /harness.html trotzdem bedient.

// Ticket 04 (Pipeline-CLI): lädt über einen `?storyboard=<Pfad>`-Query-
// Parameter wahlweise ein Storyboard zur Laufzeit statt des eingebauten Demo-
// Storyboards (`HarnessApp`s Default). Die Pipeline-CLI legt die gewünschte
// Datei vorher unter `public/harness-storyboards/` ab (Vite liefert
// `public/` unverändert über HTTP aus) und öffnet den Harness mit genau
// diesem Parameter — kein Rebuild, kein WebDriver/CDP, nur ein normaler
// Fetch derselben JSON-Form, die `parseStoryboard` schon für die eingebaute
// `storyboards/demo.json` validiert.
async function loadStoryboardFromQuery(): Promise<Storyboard | undefined> {
  const path = new URLSearchParams(window.location.search).get("storyboard");
  if (path === null) return undefined;
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Storyboard '${path}' nicht ladbar: HTTP ${response.status}`);
  }
  return parseStoryboard(await response.json());
}

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

// Kein stiller leerer Kasten bei einem kaputten/fehlenden Storyboard-Pfad
// (derselbe Grundsatz wie beim PTY-Spawn-Fehler in usePtyTerminal.ts): der
// Fehler landet sichtbar in der Konsole, der Harness fällt auf das
// eingebaute Demo-Storyboard zurück statt auf einer leeren Seite zu bleiben.
void (async () => {
  let storyboard: Storyboard | undefined;
  try {
    storyboard = await loadStoryboardFromQuery();
  } catch (error) {
    console.error("PaneCrew Harness: Storyboard konnte nicht geladen werden", error);
  }
  root.render(
    <React.StrictMode>
      <HarnessApp storyboard={storyboard} />
    </React.StrictMode>,
  );
})();
