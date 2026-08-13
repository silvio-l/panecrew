// Der eine, geteilte Theme-Applier für jeden Fenster-Entry-Point (Ticket 05:
// Live-Reload über alle Fenster) — main.tsx, about/main.tsx, settings/main.tsx
// binden ihn alle auf dieselbe Weise ein, statt jedes Fenster sein eigenes
// `settings:changed`-Abonnement mitzubringen. Löst `system` gegen
// `prefers-color-scheme` auf und setzt `document.documentElement.dataset.theme`
// — theme.css reagiert darauf über `:root[data-theme="light"]`.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type ThemeChoice = "system" | "light" | "dark";

function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === "system" || value === "light" || value === "dark";
}

function resolveSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

function resolveTheme(choice: ThemeChoice): "light" | "dark" {
  return choice === "system" ? resolveSystemTheme() : choice;
}

function apply(choice: ThemeChoice) {
  document.documentElement.dataset.theme = resolveTheme(choice);
}

/**
 * Starts applying `appearance.theme` to this document and keeps it live:
 * the initial resolved value, every `settings:changed` update, and every OS
 * `prefers-color-scheme` flip while `system` is selected. Returns an unsubscribe
 * function for the (rare, in practice never-unmounted) entry-point cleanup.
 */
export function initThemeApplier(): () => void {
  let current: ThemeChoice = "system";

  const media = window.matchMedia("(prefers-color-scheme: light)");
  const onMediaChange = () => apply(current);
  media.addEventListener("change", onMediaChange);

  const refreshFromBackend = () => {
    void invoke<Record<string, unknown>>("settings_get_values").then((values) => {
      if (isThemeChoice(values["appearance.theme"])) {
        current = values["appearance.theme"];
        apply(current);
      }
    });
  };
  refreshFromBackend();

  const unlistenPromise = listen<{ key: string; value: unknown }>(
    "settings:changed",
    (event) => {
      const { key, value } = event.payload;
      if (key === "appearance.theme" && isThemeChoice(value)) {
        current = value;
        apply(current);
      } else if (key === "*") {
        refreshFromBackend();
      }
    },
  );

  return () => {
    media.removeEventListener("change", onMediaChange);
    void unlistenPromise.then((unlisten) => unlisten());
  };
}
