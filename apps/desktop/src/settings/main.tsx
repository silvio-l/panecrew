import React from "react";
import ReactDOM from "react-dom/client";
import "../i18n";
import { SettingsWindow } from "./SettingsWindow";
import "./settings.css";
import { initThemeApplier } from "../theme/applyTheme";
import { initLanguageApplier } from "../i18n/applyLanguage";

initThemeApplier();
initLanguageApplier();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <SettingsWindow />
  </React.StrictMode>,
);
