import React from "react";
import ReactDOM from "react-dom/client";
import "../i18n";
import "../App.css";
import { HarnessApp } from "./HarnessApp";

// Zweiter Vite-Einstieg neben `main.tsx`/`about/main.tsx` — absichtlich NICHT
// in vite.config.ts' `build.rollupOptions.input` eingetragen (ADR-0001):
// `vite build` (über `pnpm tauri build`) bündelt nur, was dort steht, dieser
// Einstieg ist also nie Teil des Produktions-Bundles, obwohl der Vite-
// Dev-Server (`pnpm tauri dev`) ihn unter /harness.html trotzdem bedient.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <HarnessApp />
  </React.StrictMode>,
);
