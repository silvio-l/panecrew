// Marketplace-review / GitHub-star prompt. Same "opt-in, never applied
// silently" family as themeOffer.ts/attentionAdapterOffer.ts, but unlike
// those once-per-machine offers this one is usage-gated (see
// reviewPromptState.ts) and reversible (a "maybe later"/silent dismissal
// backs off for a cooldown instead of never asking again), specifically so
// it doesn't nag: fires only after real engagement, and routes detractors to
// a private feedback channel (a GitHub issue) instead of pushing them toward
// a public review, per standard review-prompt best practice (ask happy users
// to go public, ask unhappy ones for honest feedback in private).
import * as vscode from "vscode";
import type { Memento as GlobalMemento } from "../vscodeMemento";
import {
  REVIEW_PROMPT_DISMISS_POSTPONE_MS,
  REVIEW_PROMPT_POSTPONE_MS,
  shouldShowReviewPrompt,
  type ReviewPromptRecord,
  type ReviewPromptResponse,
} from "./reviewPromptState";
export type { GlobalMemento };

const RECORD_KEY = "panecrew.reviewPromptRecord";

const MARKETPLACE_REVIEW_URL =
  "https://marketplace.visualstudio.com/items?itemName=silvio-lindstedt.panecrew&ssr=false#review-details";
const GITHUB_REPO_URL = "https://github.com/silvio-l/panecrew";
const GITHUB_NEW_ISSUE_URL =
  "https://github.com/silvio-l/panecrew/issues/new?labels=feedback&title=" +
  encodeURIComponent("Feedback: ");

function loadRecord(memento: GlobalMemento): ReviewPromptRecord {
  return (
    memento.get<ReviewPromptRecord>(RECORD_KEY) ?? {
      engagementCount: 0,
      firstEngagedAt: null,
      response: "unset",
      postponedUntil: null,
    }
  );
}

function saveRecord(memento: GlobalMemento, record: ReviewPromptRecord): Promise<void> {
  return Promise.resolve(memento.update(RECORD_KEY, record));
}

/** Called from the same "user successfully added a folder to the grid"
 * choke point as `recordRecentProject` — the cheapest available proxy for
 * "got real value out of PaneCrew this session". */
export async function recordReviewPromptEngagement(
  memento: GlobalMemento,
  now: () => number = Date.now,
): Promise<void> {
  const record = loadRecord(memento);
  if (record.response === "done") return;
  await saveRecord(memento, {
    ...record,
    engagementCount: record.engagementCount + 1,
    firstEngagedAt: record.firstEngagedAt ?? now(),
  });
}

async function respond(
  memento: GlobalMemento,
  record: ReviewPromptRecord,
  response: ReviewPromptResponse,
): Promise<void> {
  await saveRecord(memento, { ...record, response, postponedUntil: null });
}

async function postpone(memento: GlobalMemento, record: ReviewPromptRecord, delayMs: number, now: number): Promise<void> {
  await saveRecord(memento, { ...record, postponedUntil: now + delayMs });
}

async function showHappyPathPrompt(memento: GlobalMemento, record: ReviewPromptRecord, now: number): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    "Awesome — a rating or a star helps a lot and takes a few seconds:",
    "Rate on Marketplace",
    "Star on GitHub",
    "Maybe later",
  );
  if (choice === "Rate on Marketplace") {
    await vscode.env.openExternal(vscode.Uri.parse(MARKETPLACE_REVIEW_URL));
    await respond(memento, record, "done");
  } else if (choice === "Star on GitHub") {
    await vscode.env.openExternal(vscode.Uri.parse(GITHUB_REPO_URL));
    await respond(memento, record, "done");
  } else {
    await postpone(memento, record, REVIEW_PROMPT_POSTPONE_MS, now);
  }
}

async function showFeedbackPrompt(memento: GlobalMemento, record: ReviewPromptRecord, now: number): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    "Sorry to hear that. Please tell us what's missing or broken — it goes straight to the maintainer, not a public review:",
    "Open a GitHub Issue",
    "Not now",
  );
  if (choice === "Open a GitHub Issue") {
    await vscode.env.openExternal(vscode.Uri.parse(GITHUB_NEW_ISSUE_URL));
    await respond(memento, record, "done");
  } else {
    await postpone(memento, record, REVIEW_PROMPT_POSTPONE_MS, now);
  }
}

async function runReviewPromptFlow(memento: GlobalMemento, record: ReviewPromptRecord, nowMs: number): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    "Enjoying PaneCrew so far?",
    "I like it",
    "Needs work",
    "Don't ask again",
  );
  if (choice === "I like it") {
    await showHappyPathPrompt(memento, record, nowMs);
  } else if (choice === "Needs work") {
    await showFeedbackPrompt(memento, record, nowMs);
  } else if (choice === "Don't ask again") {
    await respond(memento, record, "done");
  } else {
    // Dismissed without a click (Escape / clicked away) — back off briefly
    // rather than treating silence as a "no".
    await postpone(memento, record, REVIEW_PROMPT_DISMISS_POSTPONE_MS, nowMs);
  }
}

/** Automatic, usage-gated offer — fires at most once per cooldown window,
 * and never again once the user gives a definitive answer. */
export async function maybeShowReviewPrompt(memento: GlobalMemento, now: () => number = Date.now): Promise<void> {
  const record = loadRecord(memento);
  const nowMs = now();
  if (!shouldShowReviewPrompt(record, nowMs)) return;
  await runReviewPromptFlow(memento, record, nowMs);
}

/** `PaneCrew: Rate PaneCrew / Give Feedback…` — the same two-step flow,
 * runnable on demand from the Command Palette regardless of the usage gate,
 * for a user who wants to rate or leave feedback without waiting to be
 * asked. */
export function registerRateOrGiveFeedbackCommand(memento: GlobalMemento): vscode.Disposable {
  return vscode.commands.registerCommand("panecrew.rateOrGiveFeedback", async () => {
    const record = loadRecord(memento);
    await runReviewPromptFlow(memento, record, Date.now());
  });
}
