import { CHROME_FOCUS_RING } from "../components/ChromeTooltip";

// The first-run/restart hint, anchored to one empty grid slot — same
// sibling-to-the-button position as `PaneDropInvite` (`ProjectPicker.tsx`'s
// `dropInvite` prop), reused here as `onboardingHint` rather than a new
// positioning scheme. Unlike `PaneDropInvite` this isn't a transient
// drag-HUD instrument: it persists until dismissed or the Aha-Moment fires,
// so it needs its own dismiss control and can't be `aria-hidden`.
//
// Amber accent wash, same "invitation, not focus state" semantics
// `ProjectPicker.tsx`'s own hover state already claims for an empty slot
// (see that file's header comment) — this doesn't introduce a second
// reserved-accent surface, it's the same one.
export function OnboardingHint({
  title,
  body,
  dismissLabel,
  onDismiss,
}: {
  /** Already translated (same convention as `PaneDropInvite`'s `label` —
   * this component stays free of an i18n import, the caller has `t()`
   * already). */
  title: string;
  body: string;
  dismissLabel: string;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute inset-x-2 bottom-2 z-20 flex justify-center"
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
