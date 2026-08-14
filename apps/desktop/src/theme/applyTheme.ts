// Der eine, geteilte Theme-Applier für jeden Fenster-Entry-Point (Ticket 05:
// Live-Reload über alle Fenster) — main.tsx, about/main.tsx, settings/main.tsx
// binden ihn alle auf dieselbe Weise ein, statt jedes Fenster sein eigenes
// `settings:changed`-Abonnement mitzubringen. Löst `system` gegen
// `prefers-color-scheme` auf und setzt `document.documentElement.dataset.theme`
// — theme.css reagiert darauf über `:root[data-theme="light"]`.
//
// Fetch/Abo laufen seit Ticket 08 über `settingsStore.ts` statt über ein
// eigenes `invoke("settings_get_values")`/`listen("settings:changed")` —
// dasselbe Fenster teilt sich den einen Fetch/Listener mit jedem anderen
// Applier/Hook, statt je einen eigenen zu öffnen.
import { getSettingsValues, subscribeToSettingsChanges } from "../settings/settingsStore";

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

  const applyFromValues = (values: Record<string, unknown>) => {
    if (isThemeChoice(values["appearance.theme"])) {
      current = values["appearance.theme"];
      apply(current);
    }
  };
  void getSettingsValues().then(applyFromValues);

  const unsubscribe = subscribeToSettingsChanges((event) => {
    if (event.key === "appearance.theme" && isThemeChoice(event.value)) {
      current = event.value;
      apply(current);
    } else if (event.key === "*") {
      applyFromValues(event.values);
    }
  });

  return () => {
    media.removeEventListener("change", onMediaChange);
    unsubscribe();
  };
}
