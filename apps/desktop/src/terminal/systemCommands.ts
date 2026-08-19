import i18next from "../i18n";
import type { SnippetCandidate } from "./snippetTrigger";

// The `://`-Trigger's built-in, non-authorable commands (spec, story 17:
// "authored snippets always insert text, built-ins always perform an
// action"). Fixed in-code, never read from a file — same "small trusted
// in-code list" shape as `adapters.ts`'s `ADAPTERS`.
//
// A function, not a static array: `description` goes through `i18next.t()`,
// and `listCandidates()` is re-evaluated on every completion render pass
// (`inlineSuggestion.ts`'s `render()`), so a live language switch is picked
// up the same way `directoryPopup.ts`'s footer hints already are — a
// snapshotted array computed once at module load would go stale instead.
export function systemCommands(): readonly SnippetCandidate[] {
  return [
    {
      trigger: "init",
      description: i18next.t("systemCommands.init.description"),
      kind: "command",
    },
  ];
}
