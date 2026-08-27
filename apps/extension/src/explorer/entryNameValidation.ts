// Pure validation, no vscode import — same split as the rest of the repo
// (gridState.ts, snippetTrigger.ts) keeps this independently unit-testable
// without pulling in the vscode module, which only resolves inside a real
// extension host.
export function validateEntryName(name: string): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return "Name can't be empty.";
  if (trimmed === "." || trimmed === "..") return "That's not a valid name.";
  if (trimmed.includes("/") || trimmed.includes("\\")) return "Name can't contain a path separator.";
  return undefined;
}
