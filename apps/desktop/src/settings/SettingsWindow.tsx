// Der Settings-Editor — eigenes Fenster (settings.html), gerendert über
// useSettings.ts (Ticket 03). Kategoriebaum links, Suchfeld + Rohtext-
// Umschalter oben, Kontrollen rechts (Ticket 04); Terminal-Neustart-Hinweis
// (Ticket 06) und der Rohtext-Modus (Ticket 07) sind Teil desselben Editors,
// nicht eigener Bildschirme — derselbe Ort für jede Art, ein Setting zu
// ändern. Extension-Settings (Ticket 09) laufen durch dieselben Kontrollen
// und dieselbe Suche wie Core-Settings, stehen im Kategoriebaum aber in
// einer eigenen, per Trennlinie abgesetzten Sektion (Kategorie-ID = die
// Extension-ID selbst, unübersetzt — es gibt keinen ladenden Extension-Host,
// der eigene Locale-Strings mitbringen könnte). Reine TUI-Register-Sprache
// wie Explorer/TitleBar/Pane: Terminal-Monospace für technische
// Beschriftung, harte 0ms-Zustandswechsel, 150ms nur auf Hover, kein Glow,
// der Akzent bleibt Amber und exklusiv (hier: nichts in diesem Fenster trägt
// je Pane-Fokus, also kommt der Akzent hier gar nicht vor — Auswahl läuft
// über die neutralen List-Tokens, wie beim TemplateSwitcher).
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CHROME_FOCUS_RING } from "../components/ChromeTooltip";
import { TemplateGlyph } from "../components/TemplateSwitcher";
import { ToggleSwitch } from "../components/ToggleSwitch";
import { GRID_TEMPLATES } from "../grid/gridState";
import { info } from "../logging/log";
import { restartOnboarding } from "../onboarding/onboarding";
import { isMacPlatform } from "../shortcuts/platform";
import { MAX_ZOOM, MIN_ZOOM } from "../shortcuts/zoom";
import { useSettings, type SettingSchemaEntry } from "./useSettings";

const CORE_CATEGORY_ORDER = ["terminal", "explorer", "appearance", "grid"];
// "help" is not schema-driven (no settings registry entries) — added
// unconditionally rather than gated on `schema` presence like the core/
// extension categories above, and rendered via its own `HelpCategoryPanel`
// branch instead of the generic `SettingRow` list (see `selectedCategory ===
// "help"` below).
const STATIC_CATEGORIES = ["help"];

function i18nBase(entry: SettingSchemaEntry): string | null {
  return entry.description.kind === "i18nKey"
    ? entry.description.key.replace(/\.description$/, "")
    : null;
}

// Extension manifests (ticket 08) carry only a `description`, no separate
// title — VS Code's own `contributes.configuration.properties` shape has no brandlint-ok: funktionaler Formatvergleich, kein Marketing
// title field either, so a label is derived from the key's last dot segment
// instead of reusing the description text, which `descriptionOf` below
// already renders in full underneath.
function humanizeKeySegment(key: string): string {
  const last = key.split(".").pop() ?? key;
  const spaced = last.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Untere/obere Schranke pro numerischem Setting, rein clientseitig (Ticket
// 07s Rohtext-Editor kann diese Grenzen weiterhin umgehen — dieselbe Lücke
// hat der bisherige appearance.zoom-Fall schon immer gehabt, hier nur
// konsequent auf alle Number-Settings dieses Fensters ausgedehnt statt nur
// auf eines). Ohne Schranke committete ein geleertes/negatives Feld z. B.
// eine unbrauchbare Schriftgröße 0px, ohne dass irgendetwas das verhindert.
const NUMBER_BOUNDS: Record<string, [number, number]> = {
  "appearance.zoom": [MIN_ZOOM, MAX_ZOOM],
  "terminal.fontSize": [6, 72],
  "terminal.activityIdleMs": [100, 60_000],
  "terminal.activityLineThreshold": [1, 1000],
};

function labelOf(entry: SettingSchemaEntry, t: (key: string) => string): string {
  const base = i18nBase(entry);
  if (base) return t(`${base}.label`);
  return entry.description.kind === "literal" ? humanizeKeySegment(entry.key) : entry.key;
}

function descriptionOf(entry: SettingSchemaEntry, t: (key: string) => string): string {
  return entry.description.kind === "i18nKey"
    ? t(entry.description.key)
    : entry.description.text;
}

export function SettingsWindow() {
  const { t } = useTranslation();
  const { schema, values, loading, pendingKeys, error, setValue, resetValue } =
    useSettings();
  const [selectedCategory, setSelectedCategory] = useState<string>("terminal");
  const [query, setQuery] = useState("");
  const [rawMode, setRawMode] = useState(false);

  useEffect(() => {
    // Fenster startet unsichtbar (`settings_window.rs`, `.visible(false)`)
    // und deckt sich erst hier selbst auf — Kategoriebaum + Suchfeld + der
    // "Lade..."-Text stehen schon beim Mount, bevor Schema/Werte überhaupt
    // ankommen, also wird nicht auf `useSettings()`s `loading` gewartet.
    // KEIN requestAnimationFrame: dieselbe Falle wie in About.tsx dokumentiert
    // — ein noch unsichtbares WKWebView bekommt auf macOS keine regulären
    // Frame-Callbacks mehr, das hätte hier bis zu ~1s zusätzliche Verzögerung
    // bedeutet. Rust hat für den Fall, dass dieser Aufruf nie ankommt, ohnehin
    // eine eigene Zeitschranke (REVEAL_WATCHDOG).
    void invoke("settings_visible");
  }, []);

  // Core-Kategorien in fester, kuratierter Reihenfolge; jede weitere
  // Kategorie im Schema kommt von einer Extension (`source` ist deren
  // Extension-ID, nicht "core") — ihre Reihenfolge ist alphabetisch, da es
  // dafür keine kuratierte Vorgabe gibt.
  const coreCategories = useMemo(() => {
    const present = new Set(schema.map((entry) => entry.category));
    return CORE_CATEGORY_ORDER.filter((id) => present.has(id));
  }, [schema]);
  const extensionCategories = useMemo(() => {
    const ids = new Set(
      schema.filter((entry) => entry.source !== "core").map((entry) => entry.category),
    );
    return Array.from(ids).sort();
  }, [schema]);

  const trimmedQuery = query.trim().toLowerCase();
  const visibleEntries = useMemo(() => {
    if (trimmedQuery) {
      return schema.filter((entry) => {
        const label = labelOf(entry, t).toLowerCase();
        const description = descriptionOf(entry, t).toLowerCase();
        return label.includes(trimmedQuery) || description.includes(trimmedQuery);
      });
    }
    return schema.filter((entry) => entry.category === selectedCategory);
  }, [schema, trimmedQuery, selectedCategory, t]);

  return (
    <div className="flex h-screen flex-col bg-(--pc-app-background) text-(--pc-foreground)">
      <header className="flex shrink-0 items-center gap-2 border-b border-(--pc-titleBar-border) px-3 py-2">
        <SearchField query={query} onChange={setQuery} t={t} />
        <button
          type="button"
          onClick={() => setRawMode((current) => !current)}
          aria-pressed={rawMode}
          className={`shrink-0 rounded-sm border px-2 py-1 font-(family-name:--pc-terminal-fontFamily) text-(length:--pc-chrome-fontSizeSmall) uppercase tracking-[0.1em] transition-colors ${
            rawMode
              ? "border-(--pc-widget-border) bg-(--pc-list-activeSelectionBackground) text-(--pc-list-activeSelectionForeground)"
              : "border-(--pc-widget-border) text-(--pc-descriptionForeground) hover:text-(--pc-foreground)"
          } ${CHROME_FOCUS_RING}`}
        >
          {rawMode ? t("settings.rawJson.toggleToGraphical") : t("settings.rawJson.toggleToRaw")}
        </button>
      </header>

      {error && (
        <div className="shrink-0 border-b border-(--pc-widget-border) bg-(--pc-widget-background) px-3 py-1.5 text-(length:--pc-chrome-fontSizeSmall) text-(--pc-descriptionForeground)">
          {t("settings.loadError")}
        </div>
      )}

      {rawMode ? (
        <RawJsonView onDone={() => setRawMode(false)} t={t} />
      ) : (
        <div className="flex min-h-0 flex-1">
          <nav
            aria-label={t("settings.windowTitle")}
            className="w-40 shrink-0 overflow-y-auto border-r border-(--pc-widget-border) p-1.5"
          >
            {coreCategories.map((id) => (
              <CategoryButton
                key={id}
                id={id}
                label={t(`settings.categories.${id}`)}
                active={!trimmedQuery && id === selectedCategory}
                onSelect={() => {
                  setQuery("");
                  setSelectedCategory(id);
                }}
              />
            ))}
            {extensionCategories.length > 0 && (
              <div role="separator" className="my-1.5 border-t border-(--pc-widget-border)" />
            )}
            {extensionCategories.map((id) => (
              <CategoryButton
                key={id}
                id={id}
                label={id}
                active={!trimmedQuery && id === selectedCategory}
                onSelect={() => {
                  setQuery("");
                  setSelectedCategory(id);
                }}
              />
            ))}
            <div role="separator" className="my-1.5 border-t border-(--pc-widget-border)" />
            {STATIC_CATEGORIES.map((id) => (
              <CategoryButton
                key={id}
                id={id}
                label={t(`settings.categories.${id}`)}
                active={!trimmedQuery && id === selectedCategory}
                onSelect={() => {
                  setQuery("");
                  setSelectedCategory(id);
                }}
              />
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {!trimmedQuery && selectedCategory === "help" ? (
              <HelpCategoryPanel t={t} />
            ) : loading ? (
              <p className="text-(length:--pc-chrome-fontSizeSmall) text-(--pc-descriptionForeground)">
                {t("common.loading")}
              </p>
            ) : visibleEntries.length === 0 && trimmedQuery ? (
              <p className="text-(length:--pc-chrome-fontSizeSmall) text-(--pc-descriptionForeground)">
                {t("settings.noSearchResults", { query })}
              </p>
            ) : (
              <div className="flex flex-col divide-y divide-(--pc-widget-border)">
                {visibleEntries.map((entry) => (
                  <SettingRow
                    key={entry.key}
                    entry={entry}
                    value={values[entry.key]}
                    pending={pendingKeys.has(entry.key)}
                    onSetValue={setValue}
                    onResetValue={resetValue}
                    t={t}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryButton({
  id,
  label,
  active,
  onSelect,
}: {
  id: string;
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      key={id}
      type="button"
      onClick={onSelect}
      aria-current={active}
      className={`flex h-(--pc-list-rowHeight) w-full items-center gap-1.5 rounded px-2 font-(family-name:--pc-terminal-fontFamily) text-(length:--pc-chrome-fontSize) transition-colors ${
        active
          ? "bg-(--pc-list-activeSelectionBackground) text-(--pc-list-activeSelectionForeground)"
          : "text-(--pc-descriptionForeground) hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-foreground)"
      } ${CHROME_FOCUS_RING}`}
    >
      <span aria-hidden="true" className="w-2.5 shrink-0 text-center">
        {active ? "❯" : ""}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function SearchField({
  query,
  onChange,
  t,
}: {
  query: string;
  onChange: (value: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <input
      type="text"
      value={query}
      onChange={(event) => onChange(event.target.value)}
      placeholder={t("settings.searchPlaceholder")}
      aria-label={t("settings.searchAria")}
      className="min-w-0 flex-1 rounded-sm border border-(--pc-widget-border) bg-(--pc-widget-background) px-2 py-1 font-(family-name:--pc-terminal-fontFamily) text-(length:--pc-chrome-fontSize) text-(--pc-foreground) outline-none placeholder:text-(--pc-descriptionForeground) focus:border-(--pc-focusBorder)"
    />
  );
}

function SettingRow({
  entry,
  value,
  pending,
  onSetValue,
  onResetValue,
  t,
}: {
  entry: SettingSchemaEntry;
  value: unknown;
  pending: boolean;
  onSetValue: (key: string, value: unknown) => Promise<void>;
  onResetValue: (key: string) => Promise<void>;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const label = labelOf(entry, t);
  const description = descriptionOf(entry, t);
  const base = i18nBase(entry);
  const isOverridden = value !== entry.default;

  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-(length:--pc-chrome-fontSize) text-(--pc-foreground)">
            {label}
          </span>
          {isOverridden && (
            <span className="rounded-full bg-(--pc-widget-background) px-1.5 py-px font-(family-name:--pc-terminal-fontFamily) text-[10px] tracking-[0.1em] text-(--pc-descriptionForeground) uppercase">
              {t("settings.modifiedBadge")}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-(length:--pc-chrome-fontSizeSmall) text-(--pc-descriptionForeground)">
          {description}
        </p>
        {entry.key === "terminal.shell" && (
          <p className="mt-0.5 font-(family-name:--pc-terminal-fontFamily) text-[10px] tracking-[0.05em] text-(--pc-descriptionForeground)">
            {t("settings.terminalRestartHint")}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <SettingControl
          entry={entry}
          value={value}
          pending={pending}
          base={base}
          onSetValue={onSetValue}
          t={t}
        />
        <button
          type="button"
          onClick={() => void onResetValue(entry.key)}
          disabled={!isOverridden || pending}
          aria-label={t("settings.resetAria", { label })}
          className={`flex size-6 shrink-0 items-center justify-center rounded-md text-(--pc-descriptionForeground) transition-colors hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-foreground) disabled:pointer-events-none disabled:opacity-0 ${CHROME_FOCUS_RING}`}
        >
          <span aria-hidden="true">↺</span>
        </button>
      </div>
    </div>
  );
}

function SettingControl({
  entry,
  value,
  pending,
  base,
  onSetValue,
  t,
}: {
  entry: SettingSchemaEntry;
  value: unknown;
  pending: boolean;
  base: string | null;
  onSetValue: (key: string, value: unknown) => Promise<void>;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  if (entry.type.kind === "boolean") {
    // Form, Farbverhältnis und die Amber-Freigabe für genau diese Stelle sind
    // im Kopf von ToggleSwitch.tsx hergeleitet — inklusive der Messung, warum
    // die vorige Pille (Amber-Füllung, Knopf in --pc-foreground) in keinem
    // der beiden Themes lesbar war.
    return (
      <ToggleSwitch
        checked={value === true}
        disabled={pending}
        onChange={(next) => void onSetValue(entry.key, next)}
        label={labelOf(entry, t)}
        onText={t("settings.toggle.on")}
        offText={t("settings.toggle.off")}
      />
    );
  }

  if (entry.type.kind === "enum") {
    // grid.defaultTemplate zeigt dieselben Piktogramme wie der
    // TemplateSwitcher oben rechts im Hauptfenster, statt einer Textliste zu
    // erfinden — Nutzervorgabe: diese Einstellung soll sich an dem
    // orientieren, was dort bereits existiert, nicht an etwas Eigenem.
    if (entry.key === "grid.defaultTemplate") {
      return (
        <div
          role="group"
          className="flex shrink-0 items-center gap-px rounded-md border border-(--pc-widget-border) p-px"
        >
          {GRID_TEMPLATES.map((template) => {
            const active = value === template.id;
            const optionLabel = t(template.labelKey);
            return (
              <button
                key={template.id}
                type="button"
                disabled={pending}
                aria-pressed={active}
                aria-label={optionLabel}
                onClick={() => void onSetValue(entry.key, template.id)}
                className={`flex size-6 shrink-0 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-50 ${
                  active
                    ? "bg-(--pc-list-activeSelectionBackground) text-(--pc-foreground)"
                    : "text-(--pc-descriptionForeground) hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-foreground)"
                } ${CHROME_FOCUS_RING}`}
              >
                <TemplateGlyph template={template.id} slotCount={template.slotCount} />
              </button>
            );
          })}
        </div>
      );
    }

    return (
      <div
        role="group"
        className="flex shrink-0 items-center gap-px rounded-md border border-(--pc-widget-border) p-px"
      >
        {entry.type.options.map((option) => {
          const active = value === option;
          const optionLabel = base ? t(`${base}.options.${option}`) : option;
          return (
            <button
              key={option}
              type="button"
              disabled={pending}
              aria-pressed={active}
              onClick={() => void onSetValue(entry.key, option)}
              className={`rounded px-2 py-1 font-(family-name:--pc-terminal-fontFamily) text-(length:--pc-chrome-fontSizeSmall) transition-colors disabled:pointer-events-none disabled:opacity-50 ${
                active
                  ? "bg-(--pc-list-activeSelectionBackground) text-(--pc-list-activeSelectionForeground)"
                  : "text-(--pc-descriptionForeground) hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-foreground)"
              } ${CHROME_FOCUS_RING}`}
            >
              {optionLabel}
            </button>
          );
        })}
      </div>
    );
  }

  if (entry.type.kind === "number") {
    return (
      <NumberSettingInput
        entryKey={entry.key}
        value={value}
        pending={pending}
        onSetValue={onSetValue}
      />
    );
  }

  const displayValue = typeof value === "string" ? value : "";
  return (
    <input
      type="text"
      disabled={pending}
      value={displayValue}
      onChange={(event) => void onSetValue(entry.key, event.target.value)}
      className="w-40 shrink-0 rounded-sm border border-(--pc-widget-border) bg-(--pc-widget-background) px-2 py-1 font-(family-name:--pc-terminal-fontFamily) text-(length:--pc-chrome-fontSize) text-(--pc-foreground) outline-none focus:border-(--pc-focusBorder) disabled:opacity-50"
    />
  );
}

/**
 * Eigene, unkontrollierte Eingabe statt `type="number"` mit direktem
 * Pro-Tastenanschlag-Commit: WKWebView akzeptiert in einem `type="number"`-
 * Feld nur "." als Dezimaltrennzeichen, unabhängig von OS-/App-Sprache — ein
 * deutschsprachiger Nutzer, der "1,2" für 120% Zoom tippt, verliert das
 * Komma schon auf Zeichenebene (Nutzer-Fund, nicht nur eine Annahme). Der
 * Commit passiert erst bei Blur/Enter, nicht bei jedem Tastendruck: ein
 * Zwischenzustand wie "1," ist keine gültige Zahl, ein sofortiges
 * `onSetValue` würde entweder NaN durchreichen oder (bei serverseitiger
 * Ablehnung) das kontrollierte Feld mit dem Nutzer um jeden Tastendruck
 * ringen lassen.
 */
function NumberSettingInput({
  entryKey,
  value,
  pending,
  onSetValue,
}: {
  entryKey: string;
  value: unknown;
  pending: boolean;
  onSetValue: (key: string, value: unknown) => Promise<void>;
}) {
  const committed = typeof value === "number" ? String(value) : "";
  const [draft, setDraft] = useState(committed);
  const [focused, setFocused] = useState(false);
  // Externe Änderungen (Reset-Button, Settings-Sync aus einem anderen
  // Fenster) sollen den Entwurf überschreiben, aber nicht während der Nutzer
  // gerade tippt — daher Anpassung während des Renders (React-Doku-Muster
  // "Adjusting state when a prop changes") statt in einem Effect, der
  // `setDraft` erst nach dem Commit synchron nachschieben würde.
  const [prevCommitted, setPrevCommitted] = useState(committed);
  if (!focused && committed !== prevCommitted) {
    setPrevCommitted(committed);
    setDraft(committed);
  }

  const commit = () => {
    const raw = draft.trim();
    // Number("") ist 0, nicht NaN — ohne den expliziten Leerstring-Check
    // würde ein geleertes Feld beim Blur eine 0 committen, bei
    // `appearance.zoom` z. B. ein unbrauchbares, aber gültig persistiertes
    // Nullfenster.
    const parsed = raw === "" ? NaN : Number(raw.replace(",", "."));
    if (!Number.isFinite(parsed)) {
      setDraft(committed);
      return;
    }
    // appearance.zoom nutzt dieselbe Grenze wie das Tastenkürzel
    // (`nextZoomLevel`/`ZOOM_LEVELS`) — sonst könnte diese Eingabe einen Zoom
    // setzen, den Shift+Cmd/Strg +/-/0 nie erreichen kann.
    const bounds = NUMBER_BOUNDS[entryKey];
    const clamped = bounds ? Math.min(bounds[1], Math.max(bounds[0], parsed)) : parsed;
    void onSetValue(entryKey, clamped);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      disabled={pending}
      value={draft}
      onFocus={() => setFocused(true)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
      className="w-40 shrink-0 rounded-sm border border-(--pc-widget-border) bg-(--pc-widget-background) px-2 py-1 font-(family-name:--pc-terminal-fontFamily) text-(length:--pc-chrome-fontSize) text-(--pc-foreground) outline-none focus:border-(--pc-focusBorder) disabled:opacity-50"
    />
  );
}

// Ticket 07: reiner Text-Editor über `settings.json`, ohne Autovervollständigung
// und ohne Inline-Validierung (Story 14) — Prüfung passiert ausschließlich beim
// Speichern, serverseitig in `settings_write_raw` (Rust validiert jeden Key
// gegen sein Schema, bevor irgendetwas auf die Platte geschrieben wird).
function RawJsonView({
  onDone,
  t,
}: {
  onDone: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Nur beim ersten Mount laden — kein Reload bei jedem Tastendruck.
    void invoke<string>("settings_read_raw").then(setText);
  }, []);

  const save = async () => {
    if (text === null) return;
    setSaving(true);
    setError(null);
    try {
      await invoke("settings_write_raw", { raw: text });
      onDone();
    } catch (saveError) {
      setError(String(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 py-3">
      <p className="text-(length:--pc-chrome-fontSizeSmall) text-(--pc-descriptionForeground)">
        {t("settings.rawJson.hint")}
      </p>
      {error && (
        <p className="rounded-sm border border-(--pc-widget-border) bg-(--pc-widget-background) px-2 py-1 text-(length:--pc-chrome-fontSizeSmall) text-(--pc-foreground)">
          {error}
        </p>
      )}
      <textarea
        value={text ?? ""}
        onChange={(event) => setText(event.target.value)}
        spellCheck={false}
        aria-label={t("settings.rawJson.toggleToRaw")}
        className="min-h-0 flex-1 resize-none rounded-sm border border-(--pc-widget-border) bg-(--pc-widget-background) p-2 font-(family-name:--pc-terminal-fontFamily) text-(length:--pc-chrome-fontSize) text-(--pc-foreground) outline-none focus:border-(--pc-focusBorder)"
      />
      <div className="flex shrink-0 justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className={`rounded-sm border border-(--pc-widget-border) px-3 py-1 text-(length:--pc-chrome-fontSizeSmall) text-(--pc-descriptionForeground) transition-colors hover:text-(--pc-foreground) ${CHROME_FOCUS_RING}`}
        >
          {t("settings.rawJson.cancel")}
        </button>
        <button
          type="button"
          disabled={saving || text === null}
          onClick={() => void save()}
          className={`rounded-sm bg-(--pc-list-activeSelectionBackground) px-3 py-1 text-(length:--pc-chrome-fontSizeSmall) text-(--pc-list-activeSelectionForeground) transition-colors disabled:opacity-50 ${CHROME_FOCUS_RING}`}
        >
          {t("settings.rawJson.save")}
        </button>
      </div>
    </div>
  );
}

// The one non-schema-driven category (`STATIC_CATEGORIES` above): the
// onboarding restart button (works on every platform) plus the macOS
// permissions dashboard folded in from the earlier permissions research —
// a single place to re-grant OS access instead of waiting for a fresh TCC
// prompt per-folder.
function HelpCategoryPanel({
  t,
}: {
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <div className="flex flex-col divide-y divide-(--pc-widget-border)">
      <OnboardingRestartRow t={t} />
      {isMacPlatform() && <PermissionsSection t={t} />}
    </div>
  );
}

// Same row shape as `SettingRow` (label + description on the left, control
// on the right) even though this isn't a schema entry — a button instead of
// a toggle/enum control, restarting the first-run hint from `App.tsx`
// instead of writing a config value.
function OnboardingRestartRow({
  t,
}: {
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  // Local-only "restarted" confirmation. `restartOnboarding()` resets BOTH
  // onboarding phases and shows the wizard as an app-window overlay in the
  // MAIN window, not this one — this confirmation is what tells the user
  // to go look there, since the settings window itself shows nothing.
  const [restarted, setRestarted] = useState(false);

  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <span className="text-(length:--pc-chrome-fontSize) text-(--pc-foreground)">
          {t("settings.help.onboarding.label")}
        </span>
        <p className="mt-0.5 text-(length:--pc-chrome-fontSizeSmall) text-(--pc-descriptionForeground)">
          {t("settings.help.onboarding.description")}
        </p>
        {restarted && (
          <p className="mt-1 text-(length:--pc-chrome-fontSizeSmall) text-(--pc-foreground)">
            {t("settings.help.onboarding.confirmation")}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => {
          void restartOnboarding();
          void info("onboarding: restarted from settings");
          setRestarted(true);
        }}
        className={`shrink-0 rounded-sm border border-(--pc-widget-border) px-3 py-1 text-(length:--pc-chrome-fontSizeSmall) text-(--pc-descriptionForeground) transition-colors hover:text-(--pc-foreground) ${CHROME_FOCUS_RING}`}
      >
        {t("settings.help.onboarding.button")}
      </button>
    </div>
  );
}

// One deep link per row: `url` is a `x-apple.systempreferences:` scheme,
// scoped in `capabilities/settings.json` (the plugin-opener default scope
// only covers mailto/tel/http/https — this settings window needed its own
// explicit scope entry for the systempreferences scheme). Only the two
// long-stable anchors (Full Disk Access, Files and Folders) plus the bare
// Privacy & Security pane are used — no Sequoia-specific "App Data" anchor,
// since no stable one could be confirmed.
function PermissionsSection({
  t,
}: {
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [openError, setOpenError] = useState(false);
  const open = (url: string) => {
    setOpenError(false);
    void openUrl(url).catch((error: unknown) => {
      console.error("PaneCrew: Systemeinstellungen konnten nicht geöffnet werden", error);
      setOpenError(true);
    });
  };

  return (
    <div className="py-3">
      <p className="text-(length:--pc-chrome-fontSize) text-(--pc-foreground)">
        {t("settings.help.permissions.title")}
      </p>
      <p className="mt-0.5 max-w-md text-(length:--pc-chrome-fontSizeSmall) text-(--pc-descriptionForeground)">
        {t("settings.help.permissions.explainer")}
      </p>
      {openError && (
        <p className="mt-1 text-(length:--pc-chrome-fontSizeSmall) text-(--pc-descriptionForeground)">
          {t("settings.loadError")}
        </p>
      )}
      <div className="mt-2 flex flex-col items-start gap-1.5">
        <PermissionsLinkButton
          label={t("settings.help.permissions.fullDiskAccess")}
          onClick={() =>
            open("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")
          }
        />
        <PermissionsLinkButton
          label={t("settings.help.permissions.filesAndFolders")}
          onClick={() =>
            open("x-apple.systempreferences:com.apple.preference.security?Privacy_Files")
          }
        />
        <PermissionsLinkButton
          label={t("settings.help.permissions.privacySecurityOverview")}
          onClick={() => open("x-apple.systempreferences:com.apple.preference.security")}
        />
      </div>
    </div>
  );
}

function PermissionsLinkButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-sm border border-(--pc-widget-border) px-3 py-1 text-(length:--pc-chrome-fontSizeSmall) text-(--pc-descriptionForeground) transition-colors hover:text-(--pc-foreground) ${CHROME_FOCUS_RING}`}
    >
      {label} →
    </button>
  );
}
