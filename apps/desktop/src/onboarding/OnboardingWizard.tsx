import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "radix-ui";
import { invoke } from "@tauri-apps/api/core";
import { CHROME_FOCUS_RING } from "../components/ChromeTooltip";
import { PermissionsSection } from "../components/PermissionsSection";
import { getSettingsValues } from "../settings/settingsStore";
import { isMacPlatform } from "../shortcuts/platform";
import { resolveSystemTheme } from "../theme/applyTheme";

// Phase 1 of onboarding — the mandatory Initial-Setup-Wizard, shown before
// the user ever sees the live grid (first run, and again whenever
// "Einführung neu starten" fires from Settings). Phase 2 (the contextual
// in-app tour) is deliberately NOT a second wizard-like component: it's the
// existing `OnboardingHint`/`OnboardingFloatingHint` pair, already anchored
// to the real UI it's pointing at — see `App.tsx`'s onboarding wiring.
//
// Three screens: `Kann der Nutzer seinen ersten echten Erfolg erreichen,
// wenn ich diesen Schritt entferne? Wenn ja: entfernen.`
// (onboarding-prompt.md §12) still cuts a separate technical-setup screen
// (opening the first project already needs its own step here, so the
// "Ready" screen's CTA IS that step, not a preview of it — a dedicated
// picker UI inside the wizard would just be a second, parallel copy of
// `ProjectPicker.tsx`'s own empty-slot button). It no longer cuts a
// settings-personalization screen, though: that was the original design
// (language lives only in Settings since 2026-08-13, the theme default is a
// pinned product decision), reversed 2026-08-17 (product-owner decision)
// once it became clear the language default had no OS-locale detection
// behind it — a German-speaking first-time user silently got an English
// app with no prompt to fix it. The Preferences step (step 1) pre-selects
// language from `navigator.language` and theme from
// `resolveSystemTheme()`, but always leaves both editable. Each option click
// persists immediately (not deferred to the "Continue" CTA) — product
// decision, same day: picking a theme/language and NOT seeing it apply live
// reads as broken, not as "not confirmed yet". Persisting through the same
// `settings_set_value` write-through the Settings window uses means the
// existing `settings:changed` broadcast + `initLanguageApplier`/
// `initThemeApplier` (already running in this window) apply it live for
// free.
//
// Radix `Dialog` (not `AlertDialog`, see `ConfirmDialog.tsx`'s header
// comment on that distinction): this interrupts nothing destructible, so
// Escape/the close button/the explicit skip link all resolve the same way —
// there's no "cancel" state to protect. Clicking the overlay does NOT close
// it, though (`onPointerDownOutside` below), unlike a plain `Dialog` — found
// live: a stray click just outside the wizard reads as accidental, not as
// "I meant to skip the whole introduction," so it's blocked the same way
// `AlertDialog` blocks it by default, without adopting `AlertDialog` itself.
// Same material recipe as `ConfirmDialog.tsx` (`--pc-widget-*`, `--pc-dialog-
// overlayBackground`, the `pc-overlay-in`/`pc-overlay-fade-in` pair, the
// z-40/z-50 split) so this doesn't invent a second modal language for one
// component — the "may be staged more strongly than the normal work
// surface" allowance (repo conventions) is spent on copy/pacing, not on a new
// visual system.
export interface OnboardingWizardCopy {
  welcomeTitle: string;
  welcomeBody: string;
  welcomeCta: string;
  preferencesTitle: string;
  preferencesBody: string;
  languageLabel: string;
  themeLabel: string;
  languageOptionLabel: (lang: "de" | "en") => string;
  themeOptionLabel: (theme: "system" | "light" | "dark") => string;
  preferencesCta: string;
  /** macOS only (`stepKinds` below) — Windows has no equivalent TCC prompt
   * and skips straight from Preferences to Ready. */
  permissionsTitle: string;
  permissionsBody: string;
  permissionsCta: string;
  readyTitle: string;
  readyBody: string;
  readyCtaOpenProject: string;
  readySkip: string;
  /** Ready screen body when `hasExistingProject` is true — see that prop. */
  readyBodyExisting: string;
  /** Ready screen primary CTA when `hasExistingProject` is true. */
  readyCtaContinue: string;
  back: string;
  closeLabel: string;
  /** `i18next` template with `{{step}}`/`{{total}}` — announced sr-only next
   * to the (aria-hidden) dot indicator, since dots convey step position by
   * color/position alone otherwise (onboarding-prompt.md §10/§235: "kein
   * Verständnis ausschließlich durch Farbe"). Passed pre-formatted by the
   * caller (which owns `t()`) rather than a raw i18n key, matching every
   * other string on this interface. Total step count varies by platform
   * (`stepKinds` below), so both are plain numbers, not literal unions. */
  stepIndicator: (step: number, total: number) => string;
}

export function OnboardingWizard({
  copy,
  hasExistingProject,
  onOpenFirstProject,
  onSkip,
  onStepChange,
}: {
  copy: OnboardingWizardCopy;
  /** True when the grid already has at least one project open — reachable
   * only via a Settings restart (a genuine first run always starts on an
   * empty grid). The Ready screen adapts for this: its primary CTA can't
   * unconditionally be "open the first project" here, because slot 0 might
   * already hold a real, unrelated pane — `assignProjectToSlot(0)` would
   * REPLACE it (with its own leave-guard, but still a destructive surprise
   * for someone who only wanted to see the intro again). So this case gets
   * a non-destructive "Continue" that behaves exactly like skip, just
   * phrased for someone who doesn't need the CTA's original promise. */
  hasExistingProject: boolean;
  /** Closes the wizard AND triggers the real "open a project" action
   * (the same one the empty grid slot itself uses) — not a preview of it.
   * Callers must mark the wizard completed synchronously before the native
   * folder dialog actually opens, so the overlay is gone (and focus
   * restored) by the time that dialog appears. Only ever wired to the
   * primary CTA when `hasExistingProject` is false. */
  onOpenFirstProject: () => void;
  /** Closes the wizard without opening a project — Escape, the overlay,
   * the close button, the explicit skip link, AND (when
   * `hasExistingProject`) the primary CTA all resolve here alike, landing
   * back on the grid exactly as it already was. */
  onSkip: () => void;
  /** Fires once per step, including the initial mount (step 0) — instrumentation
   * hook for `onboarding_step_viewed` (§11 of the onboarding spec), kept
   * separate from focus-management below since a future caller may want one
   * without the other. */
  onStepChange?: (step: number) => void;
}) {
  // Windows has no Full-Disk-Access-style TCC prompt to pre-empt, so the
  // Permissions step (see `stepKinds`) only exists on macOS — total step
  // count is genuinely platform-dependent, not just a cosmetic skip.
  const isMac = isMacPlatform();
  const stepKinds = isMac
    ? (["welcome", "preferences", "permissions", "ready"] as const)
    : (["welcome", "preferences", "ready"] as const);
  const totalSteps = stepKinds.length;
  const [step, setStep] = useState(0);
  const currentStepKind = stepKinds[step];
  const [language, setLanguage] = useState<"de" | "en">("en");
  const [theme, setTheme] = useState<"system" | "light" | "dark">("dark");
  const primaryCtaRef = useRef<HTMLButtonElement>(null);
  // `PermissionsSection` is shared with `SettingsWindow.tsx`, which — unlike
  // the rest of this component — takes `t` directly rather than a
  // pre-formatted string through `copy`, so this is the one place in the
  // wizard that touches i18next itself.
  const { t } = useTranslation();

  // Radix auto-focuses on OPEN, once — stepping between screens doesn't
  // remount `Dialog.Root`, so without this the focus would stay on the
  // now-gone previous step's CTA instead of following to the new one.
  useEffect(() => {
    primaryCtaRef.current?.focus();
  }, [step]);

  useEffect(() => {
    onStepChange?.(step);
    // onStepChange is an instrumentation callback, not reactive state;
    // including it would re-fire on every parent render instead of only on
    // step transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Each option click both previews (local state, drives button styling)
  // and persists immediately — the user explicitly wants language/theme
  // changes to apply live, not deferred to "Continue". Persisting through
  // the same `settings_set_value` write-through the Settings window uses
  // means the existing `settings:changed` broadcast + `initLanguageApplier`/
  // `initThemeApplier` (already running in this window) apply it live for
  // free; no separate preview-application path needed. The pre-selection
  // effect below reuses this same queue for the same reason: an OS-detected
  // override is itself a "change" the user needs to see land live, not just
  // a button visually lighting up while the rest of the app stays on the old
  // value until the user happens to touch that control (found live: a
  // German-locale user saw "Deutsch" pre-selected but the surrounding UI
  // stayed English until they clicked away and back).
  //
  // Chained through a per-mount promise, not fired bare: `settings_store.rs`'s
  // write-through uses a single per-process temp-file name, so two
  // `settings_set_value` calls in flight at once race on that same temp file
  // and one silently loses its write (observed directly with the old
  // Continue-time dual-write). Human click cadence is far slower than a
  // single write-and-rename, so in practice this chain is only ever one
  // write deep — it exists to make that fact a guarantee, not an assumption.
  const pendingWriteRef = useRef<Promise<unknown>>(Promise.resolve());
  const queueSettingWrite = (key: string, value: string) => {
    pendingWriteRef.current = pendingWriteRef.current.then(() =>
      invoke("settings_set_value", { key, value }),
    );
  };

  // One-time pre-selection read, not a live subscription — re-running this
  // on every settings change would fight the user's own in-wizard clicks.
  // Treating the resolved value as still-default (`"en"`/`"dark"`) is what
  // triggers the OS-detected override; anything else means the user (or a
  // previous wizard run) already made an explicit choice, which wins and is
  // left untouched — no write needed, it already matches what's persisted.
  useEffect(() => {
    void getSettingsValues().then((values) => {
      const currentLanguage = values["appearance.language"];
      const osLanguage = navigator.language.split("-")[0]?.toLowerCase();
      if (currentLanguage === "en" && osLanguage === "de") {
        setLanguage("de");
        queueSettingWrite("appearance.language", "de");
      } else if (currentLanguage === "de" || currentLanguage === "en") {
        setLanguage(currentLanguage);
      }

      const currentTheme = values["appearance.theme"];
      if (currentTheme === "dark" && resolveSystemTheme() === "light") {
        setTheme("light");
        queueSettingWrite("appearance.theme", "light");
      } else if (
        currentTheme === "system" ||
        currentTheme === "light" ||
        currentTheme === "dark"
      ) {
        setTheme(currentTheme);
      }
    });
  }, []);

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onSkip();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-(--pc-dialog-overlayBackground) animate-[pc-overlay-fade-in_150ms_ease-out]" />
        <Dialog.Content
          onPointerDownOutside={(event) => event.preventDefault()}
          className="fixed left-1/2 top-1/2 z-50 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-(--pc-widget-border) bg-(--pc-widget-background) p-6 shadow-lg outline-none animate-[pc-overlay-in_150ms_ease-out]"
        >
          <div
            aria-hidden="true"
            className="mb-4 flex justify-center gap-1.5"
          >
            {stepKinds.map((kind, index) => (
              <span
                key={kind}
                className={`h-1.5 w-1.5 rounded-full ${index === step ? "bg-(--pc-focusBorder)" : "bg-(--pc-widget-border)"}`}
              />
            ))}
          </div>
          <span className="sr-only">
            {copy.stepIndicator(step + 1, totalSteps)}
          </span>

          {currentStepKind === "welcome" ? (
            <>
              <Dialog.Title className="text-center text-(length:--pc-chrome-fontSizeLarge) font-semibold text-(--pc-foreground)">
                {copy.welcomeTitle}
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-center text-(length:--pc-chrome-fontSize) leading-relaxed text-(--pc-descriptionForeground)">
                {copy.welcomeBody}
              </Dialog.Description>
              <div className="mt-6 flex justify-center">
                <button
                  ref={primaryCtaRef}
                  type="button"
                  onClick={() => setStep((s) => s + 1)}
                  className={`flex h-8 shrink-0 items-center rounded-md border border-(--pc-widget-border) bg-(--pc-list-activeSelectionBackground) px-4 text-(length:--pc-chrome-fontSize) font-medium text-(--pc-foreground) transition-colors hover:bg-(--pc-list-hoverBackground) ${CHROME_FOCUS_RING}`}
                >
                  {copy.welcomeCta}
                </button>
              </div>
            </>
          ) : currentStepKind === "preferences" ? (
            <>
              <Dialog.Title className="text-center text-(length:--pc-chrome-fontSizeLarge) font-semibold text-(--pc-foreground)">
                {copy.preferencesTitle}
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-center text-(length:--pc-chrome-fontSize) leading-relaxed text-(--pc-descriptionForeground)">
                {copy.preferencesBody}
              </Dialog.Description>
              <div className="mt-6 space-y-4">
                <div>
                  <div className="mb-1.5 text-(length:--pc-chrome-fontSizeSmall) font-medium text-(--pc-descriptionForeground)">
                    {copy.languageLabel}
                  </div>
                  <div className="flex gap-2">
                    {(["de", "en"] as const).map((lang) => (
                      <button
                        key={lang}
                        type="button"
                        onClick={() => {
                          setLanguage(lang);
                          queueSettingWrite("appearance.language", lang);
                        }}
                        aria-pressed={language === lang}
                        className={`flex h-8 flex-1 items-center justify-center rounded-md border px-3 text-(length:--pc-chrome-fontSize) transition-colors ${CHROME_FOCUS_RING} ${
                          language === lang
                            ? "border-(--pc-focusBorder) bg-(--pc-list-activeSelectionBackground) text-(--pc-foreground)"
                            : "border-(--pc-widget-border) text-(--pc-descriptionForeground) hover:bg-(--pc-list-hoverBackground)"
                        }`}
                      >
                        {copy.languageOptionLabel(lang)}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-1.5 text-(length:--pc-chrome-fontSizeSmall) font-medium text-(--pc-descriptionForeground)">
                    {copy.themeLabel}
                  </div>
                  <div className="flex gap-2">
                    {(["system", "light", "dark"] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => {
                          setTheme(option);
                          queueSettingWrite("appearance.theme", option);
                        }}
                        aria-pressed={theme === option}
                        className={`flex h-8 flex-1 items-center justify-center rounded-md border px-2 text-(length:--pc-chrome-fontSize) transition-colors ${CHROME_FOCUS_RING} ${
                          theme === option
                            ? "border-(--pc-focusBorder) bg-(--pc-list-activeSelectionBackground) text-(--pc-foreground)"
                            : "border-(--pc-widget-border) text-(--pc-descriptionForeground) hover:bg-(--pc-list-hoverBackground)"
                        }`}
                      >
                        {copy.themeOptionLabel(option)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-6 flex justify-center">
                <button
                  ref={primaryCtaRef}
                  type="button"
                  onClick={() => setStep((s) => s + 1)}
                  className={`flex h-8 shrink-0 items-center rounded-md border border-(--pc-widget-border) bg-(--pc-list-activeSelectionBackground) px-4 text-(length:--pc-chrome-fontSize) font-medium text-(--pc-foreground) transition-colors hover:bg-(--pc-list-hoverBackground) ${CHROME_FOCUS_RING}`}
                >
                  {copy.preferencesCta}
                </button>
              </div>
              <div className="mt-4 flex justify-start">
                <button
                  type="button"
                  onClick={() => setStep((s) => s - 1)}
                  className={`rounded px-1 text-(length:--pc-chrome-fontSizeSmall) text-(--pc-descriptionForeground) transition-colors hover:text-(--pc-foreground) ${CHROME_FOCUS_RING}`}
                >
                  {copy.back}
                </button>
              </div>
            </>
          ) : currentStepKind === "permissions" ? (
            <>
              <Dialog.Title className="text-center text-(length:--pc-chrome-fontSizeLarge) font-semibold text-(--pc-foreground)">
                {copy.permissionsTitle}
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-center text-(length:--pc-chrome-fontSize) leading-relaxed text-(--pc-descriptionForeground)">
                {copy.permissionsBody}
              </Dialog.Description>
              <div className="mt-6 flex justify-center">
                <PermissionsSection t={t} />
              </div>
              <div className="mt-6 flex justify-center">
                <button
                  ref={primaryCtaRef}
                  type="button"
                  onClick={() => setStep((s) => s + 1)}
                  className={`flex h-8 shrink-0 items-center rounded-md border border-(--pc-widget-border) bg-(--pc-list-activeSelectionBackground) px-4 text-(length:--pc-chrome-fontSize) font-medium text-(--pc-foreground) transition-colors hover:bg-(--pc-list-hoverBackground) ${CHROME_FOCUS_RING}`}
                >
                  {copy.permissionsCta}
                </button>
              </div>
              <div className="mt-4 flex justify-start">
                <button
                  type="button"
                  onClick={() => setStep((s) => s - 1)}
                  className={`rounded px-1 text-(length:--pc-chrome-fontSizeSmall) text-(--pc-descriptionForeground) transition-colors hover:text-(--pc-foreground) ${CHROME_FOCUS_RING}`}
                >
                  {copy.back}
                </button>
              </div>
            </>
          ) : (
            <>
              <Dialog.Title className="text-center text-(length:--pc-chrome-fontSizeLarge) font-semibold text-(--pc-foreground)">
                {copy.readyTitle}
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-center text-(length:--pc-chrome-fontSize) leading-relaxed text-(--pc-descriptionForeground)">
                {hasExistingProject ? copy.readyBodyExisting : copy.readyBody}
              </Dialog.Description>
              <div className="mt-6 flex justify-center">
                <button
                  ref={primaryCtaRef}
                  type="button"
                  onClick={hasExistingProject ? onSkip : onOpenFirstProject}
                  className={`flex h-8 shrink-0 items-center rounded-md border border-(--pc-widget-border) bg-(--pc-list-activeSelectionBackground) px-4 text-(length:--pc-chrome-fontSize) font-medium text-(--pc-foreground) transition-colors hover:bg-(--pc-list-hoverBackground) ${CHROME_FOCUS_RING}`}
                >
                  {hasExistingProject ? copy.readyCtaContinue : copy.readyCtaOpenProject}
                </button>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setStep((s) => s - 1)}
                  className={`rounded px-1 text-(length:--pc-chrome-fontSizeSmall) text-(--pc-descriptionForeground) transition-colors hover:text-(--pc-foreground) ${CHROME_FOCUS_RING}`}
                >
                  {copy.back}
                </button>
                {/* Bei bereits vorhandenem Projekt ist die primäre CTA
                    selbst schon der non-destruktive Ausstieg — ein
                    zusätzlicher Skip-Link daneben wäre eine zweite
                    Beschriftung für dieselbe Handlung. */}
                {!hasExistingProject && (
                  <button
                    type="button"
                    onClick={onSkip}
                    className={`rounded px-1 text-(length:--pc-chrome-fontSizeSmall) text-(--pc-descriptionForeground) transition-colors hover:text-(--pc-foreground) ${CHROME_FOCUS_RING}`}
                  >
                    {copy.readySkip}
                  </button>
                )}
              </div>
            </>
          )}

          <Dialog.Close asChild>
            <button
              type="button"
              aria-label={copy.closeLabel}
              className={`absolute right-3 top-3 rounded px-1.5 py-0.5 text-(--pc-descriptionForeground) transition-colors hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-foreground) ${CHROME_FOCUS_RING}`}
            >
              <span aria-hidden="true">×</span>
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
