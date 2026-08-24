// Content collection for the two generated product-reference docs (CLI
// flags, keyboard shortcuts). Read directly from the repo-root docs/
// directory via a glob loader — no copy lives inside apps/website, so
// docs/cli.md and docs/shortcuts.md (generated in apps/desktop, see its
// docs generation scripts) stay the single source of truth; this
// collection only renders them. Pattern is an explicit allowlist, not
// **/*.md, so docs/decisions.md and docs/agents/** (private, gitignored)
// can never end up rendered on the public site by accident.
import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";

const reference = defineCollection({
  loader: glob({ pattern: ["cli.md", "shortcuts.md"], base: "../../docs" }),
});

export const collections = { reference };
