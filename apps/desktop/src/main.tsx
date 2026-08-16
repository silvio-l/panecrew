import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./i18n";
import { initThemeApplier } from "./theme/applyTheme";
import { initTerminalSettingsApplier } from "./theme/applyTerminalSettings";
import { initTerminalActivitySettingsApplier } from "./terminal/applyActivitySettings";
import { initLanguageApplier } from "./i18n/applyLanguage";
import { installNativeContextMenuPolicy } from "./chrome/nativeContextMenuPolicy";
import { debug, error, info, warn } from "./logging/log";

initThemeApplier();
initTerminalSettingsApplier();
initTerminalActivitySettingsApplier();
initLanguageApplier();
installNativeContextMenuPolicy();

void info("frontend initialized");

// Catches what an in-tree ErrorBoundary can't: errors thrown from event
// handlers (e.g. a broken context-menu item) and unhandled promise
// rejections, neither of which React's render-time error boundaries see.
// Exactly the failure shape Bug 2 (PaneTabs.tsx context menu) would produce
// if a handler threw — this is what lets the resulting log entry outlive the
// WKWebView console the user has no way to hand over live.
window.addEventListener("error", (event) => {
  void error(`window error: ${event.message} at ${event.filename}:${event.lineno}`);
});
window.addEventListener("unhandledrejection", (event) => {
  void error(`unhandled rejection: ${String(event.reason)}`);
});

// Perf-Diagnose (2026-08-12): meldet jeden Main-Thread-Block >50ms mit Dauer
// und Quelle in die Konsole — der Unterschied zwischen "wartet auf IPC" und
// "JS-Thread selbst blockiert" ist sonst von außen nicht zu sehen. WKWebView
// unterstützt den "longtask"-Entry-Typ nicht überall zuverlässig; ein nicht
// unterstützter Typ wirft beim `observe()`-Aufruf, deshalb der try/catch statt
// einer Optional-Chain.
try {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      void warn(
        `long task ${entry.duration.toFixed(0)}ms (${entry.name}) at ${entry.startTime.toFixed(0)}ms`,
      );
    }
  }).observe({ entryTypes: ["longtask"] });
} catch {
  void debug("'longtask' performance entries not available here");
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
