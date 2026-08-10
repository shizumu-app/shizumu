/**
 * Build flat list ordered as a tree (parents first, children indented).
 * Each item gets _depth (number) and _hasChildren (boolean).
 */
export function buildTreeList(items) {
  const roots = items.filter(l => !l.parent_id);
  const childMap = new Map();
  for (const l of items) {
    if (l.parent_id) {
      if (!childMap.has(l.parent_id)) childMap.set(l.parent_id, []);
      childMap.get(l.parent_id).push(l);
    }
  }
  const result = [];
  function addWithChildren(item, depth) {
    result.push({ ...item, _depth: depth, _hasChildren: childMap.has(item.id) });
    const children = childMap.get(item.id) || [];
    for (const child of children) addWithChildren(child, depth + 1);
  }
  for (const root of roots) addWithChildren(root, 0);
  return result;
}

/**
 * Walk parent_id chain from `id` up to root, returning an array of
 * lineage rows ordered root -> self. Returns an empty array if `id`
 * is null or not found. Used by Memory + pin rows to render
 * "parent > child" breadcrumb chips.
 */
export function lineagePath(id, lineages) {
  if (!id) return [];
  const byId = new Map(lineages.map((l) => [l.id, l]));
  const out = [];
  let cur = byId.get(id);
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur);
    cur = cur.parent_id ? byId.get(cur.parent_id) : null;
  }
  return out;
}

/**
 * Get all descendant IDs of a given parent.
 */
export function getDescendantIds(parentId, lineages) {
  const childMap = new Map();
  for (const l of lineages) {
    if (l.parent_id) {
      if (!childMap.has(l.parent_id)) childMap.set(l.parent_id, []);
      childMap.get(l.parent_id).push(l);
    }
  }
  const ids = [];
  function walk(id) {
    const children = childMap.get(id) || [];
    for (const c of children) {
      ids.push(c.id);
      walk(c.id);
    }
  }
  walk(parentId);
  return ids;
}

/**
 * Check if an item is visible given the set of expanded IDs.
 * Root items (depth 0) are always visible.
 * Children are visible only if all their ancestors are expanded.
 */
export function isItemVisible(item, lineages, expandedIds) {
  if (!item.parent_id) return true;
  let current = item;
  while (current.parent_id) {
    if (!expandedIds.has(current.parent_id)) return false;
    current = lineages.find(l => l.id === current.parent_id);
    if (!current) break;
  }
  return true;
}
