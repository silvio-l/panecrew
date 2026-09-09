// Pure eligibility logic for the Marketplace-review / GitHub-star prompt, no
// vscode import — same split as onboardingState.ts. The prompt must not nag:
// it only fires after real, sustained engagement (a time gate AND a usage-
// count gate, not just "installed"), backs off for a cooldown period on any
// non-committal dismissal, and never fires again once the user has given a
// definitive answer (rated/starred, gave feedback, or opted out).

/** `"unset"` = never asked (or asked and silently dismissed/postponed).
 * `"done"` = got a definitive response — rated/starred, gave feedback via
 * the GitHub issue link, or explicitly chose "Don't ask again". Once
 * `"done"`, the prompt never fires again. */
export type ReviewPromptResponse = "unset" | "done";

export interface ReviewPromptRecord {
  /** How many times the user has completed the core "add a folder to the
   * grid" action — the cheapest available proxy for "got real value out of
   * PaneCrew", tracked across sessions via `ExtensionContext.globalState`. */
  engagementCount: number;
  /** When engagement was first recorded, or `null` before that ever
   * happened. Used for the minimum-install-age gate. */
  firstEngagedAt: number | null;
  response: ReviewPromptResponse;
  /** Set whenever the user dismisses/postpones without a definitive answer;
   * the prompt stays silent until this time passes. `null` means no active
   * cooldown. */
  postponedUntil: number | null;
}

export const REVIEW_PROMPT_ENGAGEMENT_THRESHOLD = 15;
export const REVIEW_PROMPT_MIN_AGE_MS = 3 * 24 * 60 * 60 * 1000;
export const REVIEW_PROMPT_POSTPONE_MS = 14 * 24 * 60 * 60 * 1000;
export const REVIEW_PROMPT_DISMISS_POSTPONE_MS = 7 * 24 * 60 * 60 * 1000;

export function shouldShowReviewPrompt(record: ReviewPromptRecord, now: number): boolean {
  if (record.response === "done") return false;
  if (record.engagementCount < REVIEW_PROMPT_ENGAGEMENT_THRESHOLD) return false;
  if (record.firstEngagedAt === null) return false;
  if (now - record.firstEngagedAt < REVIEW_PROMPT_MIN_AGE_MS) return false;
  if (record.postponedUntil !== null && now < record.postponedUntil) return false;
  return true;
}
