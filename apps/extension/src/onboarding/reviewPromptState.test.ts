import { describe, expect, it } from "vitest";
import {
  REVIEW_PROMPT_DISMISS_POSTPONE_MS,
  REVIEW_PROMPT_ENGAGEMENT_THRESHOLD,
  REVIEW_PROMPT_MIN_AGE_MS,
  REVIEW_PROMPT_POSTPONE_MS,
  shouldShowReviewPrompt,
  type ReviewPromptRecord,
} from "./reviewPromptState";

const NOW = 1_700_000_000_000;

function record(overrides: Partial<ReviewPromptRecord> = {}): ReviewPromptRecord {
  return {
    engagementCount: REVIEW_PROMPT_ENGAGEMENT_THRESHOLD,
    firstEngagedAt: NOW - REVIEW_PROMPT_MIN_AGE_MS,
    response: "unset",
    postponedUntil: null,
    ...overrides,
  };
}

describe("shouldShowReviewPrompt", () => {
  it("shows once engagement threshold and minimum age are both met", () => {
    expect(shouldShowReviewPrompt(record(), NOW)).toBe(true);
  });

  it("does not show below the engagement threshold", () => {
    expect(
      shouldShowReviewPrompt(record({ engagementCount: REVIEW_PROMPT_ENGAGEMENT_THRESHOLD - 1 }), NOW),
    ).toBe(false);
  });

  it("does not show before the minimum install age has elapsed", () => {
    expect(
      shouldShowReviewPrompt(record({ firstEngagedAt: NOW - REVIEW_PROMPT_MIN_AGE_MS + 1 }), NOW),
    ).toBe(false);
  });

  it("does not show when engagement was never recorded", () => {
    expect(shouldShowReviewPrompt(record({ firstEngagedAt: null }), NOW)).toBe(false);
  });

  it("never shows again once the response is done", () => {
    expect(shouldShowReviewPrompt(record({ response: "done" }), NOW)).toBe(false);
  });

  it("does not show while an active postponement is in effect", () => {
    expect(shouldShowReviewPrompt(record({ postponedUntil: NOW + 1 }), NOW)).toBe(false);
  });

  it("shows again once a postponement has elapsed", () => {
    expect(shouldShowReviewPrompt(record({ postponedUntil: NOW - 1 }), NOW)).toBe(true);
  });

  it("stays quiet for the full dismissal cooldown, then reopens", () => {
    const dismissedAt = NOW;
    const postponedUntil = dismissedAt + REVIEW_PROMPT_DISMISS_POSTPONE_MS;
    expect(shouldShowReviewPrompt(record({ postponedUntil }), postponedUntil - 1)).toBe(false);
    expect(shouldShowReviewPrompt(record({ postponedUntil }), postponedUntil)).toBe(true);
  });

  it("stays quiet for the full 'maybe later' cooldown, then reopens", () => {
    const postponedAt = NOW;
    const postponedUntil = postponedAt + REVIEW_PROMPT_POSTPONE_MS;
    expect(shouldShowReviewPrompt(record({ postponedUntil }), postponedUntil - 1)).toBe(false);
    expect(shouldShowReviewPrompt(record({ postponedUntil }), postponedUntil)).toBe(true);
  });
});
