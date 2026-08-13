import type { TreeNode } from "./project";

// Reine Filterlogik für die pane-lokale Explorer-Suche — clientseitig über
// den bereits geladenen Baum, kein neuer Backend-Call (Ergänzung zur globalen,
// noch funktionslosen Suche in der Titelzeile). Nach dem Vorbild des Referenz-Editors: gezeigt
// wird nur der Pfad zu Treffern, nicht ganze Geschwister-Listen, die selbst
// nicht treffen — auch wenn ein Elternordner zufällig ebenfalls passt, werden
// seine Kinder trotzdem weiter gefiltert statt komplett durchgereicht.

/** `null` bei leerer/reiner Whitespace-Suche — dann gibt es nichts zu
 * filtern, der ganze Baum bleibt unangetastet sichtbar. */
export function filterTree(
  nodes: readonly TreeNode[],
  query: string,
): TreeNode[] | null {
  const needle = query.trim().toLowerCase();
  if (needle === "") return null;
  return filterNodes(nodes, needle);
}

function filterNodes(nodes: readonly TreeNode[], needle: string): TreeNode[] {
  const result: TreeNode[] = [];

  for (const node of nodes) {
    const ownMatch = node.name.toLowerCase().includes(needle);
    const isFolder = node.children !== undefined;

    if (!isFolder) {
      if (ownMatch) result.push(node);
      continue;
    }

    const children = filterNodes(node.children ?? [], needle);
    if (ownMatch || children.length > 0) {
      result.push({ ...node, children });
    }
  }

  return result;
}
