import { useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { CHROME_FOCUS_RING } from "../components/ChromeTooltip";

// Phase 1 of onboarding — the mandatory Initial-Setup-Wizard, shown before
// the user ever sees the live grid (first run, and again whenever
// "Einführung neu starten" fires from Settings). Phase 2 (the contextual
// in-app tour) is deliberately NOT a second wizard-like component: it's the
// existing `OnboardingHint`/`OnboardingFloatingHint` pair, already anchored
// to the real UI it's pointing at — see `App.tsx`'s onboarding wiring.
//
// Two screens, not the "3-5" a generic template might reach for:
// `Kann der Nutzer seinen ersten echten Erfolg erreichen, wenn ich diesen
// Schritt entferne? Wenn ja: entfernen.` (onboarding-prompt.md §12) cuts a
// separate settings-personalization screen (this app has nothing to ask —
// language lives only in Settings since 2026-08-13, the theme default is a
// pinned product decision, not a wizard question) and a separate
// technical-setup screen (opening the first project already needs its own
// step here, so the "Ready" screen's CTA IS that step, not a preview of
// it — a dedicated picker UI inside the wizard would just be a second,
// parallel copy of `ProjectPicker.tsx`'s own empty-slot button).
//
// Radix `Dialog` (not `AlertDialog`, see `ConfirmDialog.tsx`'s header
// comment on that distinction): this interrupts nothing destructible, so
// Escape/overlay-click/the close button all resolve the same way as the
// explicit skip link — there's no "cancel" state to protect. Same material
// recipe as `ConfirmDialog.tsx` (`--pc-widget-*`, `--pc-dialog-
// overlayBackground`, the `pc-overlay-in`/`pc-overlay-fade-in` pair, the
// z-40/z-50 split) so this doesn't invent a second modal language for one
// component — the "may be staged more strongly than the normal work
// surface" allowance (repo conventions) is spent on copy/pacing, not on a new
// visual system.
export interface OnboardingWizardCopy {
  welcomeTitle: string;
  welcomeBody: string;
  welcomeCta: string;
  readyTitle: string;
  readyBody: string;
  readyCtaOpenProject: string;
  readySkip: string;
  back: string;
  closeLabel: string;
}

export function OnboardingWizard({
  copy,
  onOpenFirstProject,
  onSkip,
}: {
  copy: OnboardingWizardCopy;
  /** Closes the wizard AND triggers the real "open a project" action
   * (the same one the empty grid slot itself uses) — not a preview of it.
   * Callers must mark the wizard completed synchronously before the native
   * folder dialog actually opens, so the overlay is gone (and focus
   * restored) by the time that dialog appears. */
  onOpenFirstProject: () => void;
  /** Closes the wizard without opening a project — Escape, the overlay,
   * the close button, and the explicit skip link all resolve here alike,
   * landing on the normal empty `ProjectPicker`. */
  onSkip: () => void;
}) {
  const [step, setStep] = useState<0 | 1>(0);
  const primaryCtaRef = useRef<HTMLButtonElement>(null);

  // Radix auto-focuses on OPEN, once — stepping from Welcome to Ready
  // doesn't remount `Dialog.Root`, so without this the focus would stay on
  // the now-gone Welcome CTA instead of following to the new step's own.
  useEffect(() => {
    primaryCtaRef.current?.focus();
  }, [step]);

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onSkip();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-(--pc-dialog-overlayBackground) animate-[pc-overlay-fade-in_150ms_ease-out]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-(--pc-widget-border) bg-(--pc-widget-background) p-6 shadow-lg outline-none animate-[pc-overlay-in_150ms_ease-out]">
          <div
            aria-hidden="true"
            className="mb-4 flex justify-center gap-1.5"
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${step === 0 ? "bg-(--pc-focusBorder)" : "bg-(--pc-widget-border)"}`}
            />
            <span
              className={`h-1.5 w-1.5 rounded-full ${step === 1 ? "bg-(--pc-focusBorder)" : "bg-(--pc-widget-border)"}`}
            />
          </div>

          {step === 0 ? (
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
                  onClick={() => setStep(1)}
                  className={`flex h-8 shrink-0 items-center rounded-md border border-(--pc-widget-border) bg-(--pc-list-activeSelectionBackground) px-4 text-(length:--pc-chrome-fontSize) font-medium text-(--pc-foreground) transition-colors hover:bg-(--pc-list-hoverBackground) ${CHROME_FOCUS_RING}`}
                >
                  {copy.welcomeCta}
                </button>
              </div>
            </>
          ) : (
            <>
              <Dialog.Title className="text-center text-(length:--pc-chrome-fontSizeLarge) font-semibold text-(--pc-foreground)">
                {copy.readyTitle}
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-center text-(length:--pc-chrome-fontSize) leading-relaxed text-(--pc-descriptionForeground)">
                {copy.readyBody}
              </Dialog.Description>
              <div className="mt-6 flex justify-center">
                <button
                  ref={primaryCtaRef}
                  type="button"
                  onClick={onOpenFirstProject}
                  className={`flex h-8 shrink-0 items-center rounded-md border border-(--pc-widget-border) bg-(--pc-list-activeSelectionBackground) px-4 text-(length:--pc-chrome-fontSize) font-medium text-(--pc-foreground) transition-colors hover:bg-(--pc-list-hoverBackground) ${CHROME_FOCUS_RING}`}
                >
                  {copy.readyCtaOpenProject}
                </button>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setStep(0)}
                  className={`rounded px-1 text-(length:--pc-chrome-fontSizeSmall) text-(--pc-descriptionForeground) transition-colors hover:text-(--pc-foreground) ${CHROME_FOCUS_RING}`}
                >
                  {copy.back}
                </button>
                <button
                  type="button"
                  onClick={onSkip}
                  className={`rounded px-1 text-(length:--pc-chrome-fontSizeSmall) text-(--pc-descriptionForeground) transition-colors hover:text-(--pc-foreground) ${CHROME_FOCUS_RING}`}
                >
                  {copy.readySkip}
                </button>
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
