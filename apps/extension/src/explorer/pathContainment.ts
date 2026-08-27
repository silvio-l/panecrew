// Pure path check, no vscode import — same split as the rest of the repo.
export function isDescendantPath(candidateParent: string, maybeDescendant: string): boolean {
  if (candidateParent === maybeDescendant) return true;
  const normalizedParent = candidateParent.endsWith("/") ? candidateParent : `${candidateParent}/`;
  return maybeDescendant.startsWith(normalizedParent);
}
