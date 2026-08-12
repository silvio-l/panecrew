import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./i18n";

// Perf-Diagnose (2026-08-12): meldet jeden Main-Thread-Block >50ms mit Dauer
// und Quelle in die Konsole — der Unterschied zwischen "wartet auf IPC" und
// "JS-Thread selbst blockiert" ist sonst von außen nicht zu sehen. WKWebView
// unterstützt den "longtask"-Entry-Typ nicht überall zuverlässig; ein nicht
// unterstützter Typ wirft beim `observe()`-Aufruf, deshalb der try/catch statt
// einer Optional-Chain.
try {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      console.debug(
        `PaneCrew: Long Task ${entry.duration.toFixed(0)}ms (${entry.name}) bei ${entry.startTime.toFixed(0)}ms`,
      );
    }
  }).observe({ entryTypes: ["longtask"] });
} catch {
  console.debug("PaneCrew: 'longtask'-Performance-Entries hier nicht verfügbar");
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
