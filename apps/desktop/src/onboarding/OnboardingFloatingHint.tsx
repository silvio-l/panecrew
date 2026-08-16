import { CHROME_FOCUS_RING } from "../components/ChromeTooltip";

// Fallback for the "ahaReached" variant when there's no empty grid slot to
// anchor `OnboardingHint` to (every template slot already holds a pane) —
// the exact case a Settings restart hits on a fully populated grid, which
// is what originally made "Einführung neu starten" look like a dead button
// (see onboarding_store.rs's `onboarding_restart` doc comment). Same
// role/semantics/dismiss affordance as `OnboardingHint`, just not
// slot-anchored: fixed to the window instead of `absolute` inside a slot's
// positioned ancestor.
export function OnboardingFloatingHint({
  title,
  body,
  dismissLabel,
  onDismiss,
}: {
  title: string;
  body: string;
  dismissLabel: string;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-3 z-30 flex justify-center"
    >
      <div className="pointer-events-auto flex max-w-72 animate-[pc-overlay-in_150ms_ease-out] items-start gap-2 rounded-(--pc-paneControl-radius) border border-(--pc-pane-activeBorder)/45 bg-(--pc-pane-background)/95 px-3 py-2 text-left shadow-lg">
        <div className="min-w-0 flex-1">
          <p className="text-(length:--pc-chrome-fontSizeSmall) font-medium text-(--pc-foreground)">
            {title}
          </p>
          <p className="mt-0.5 text-(length:--pc-chrome-fontSizeSmall) text-(--pc-descriptionForeground)">
            {body}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          className={`shrink-0 rounded px-1 text-(length:--pc-chrome-fontSizeSmall) text-(--pc-descriptionForeground) transition-colors hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-foreground) ${CHROME_FOCUS_RING}`}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </div>
  );
}
