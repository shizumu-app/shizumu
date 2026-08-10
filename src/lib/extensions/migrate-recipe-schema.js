// Walk a TipTap doc JSON tree and rewrite the legacy `algorithmBlock`
// node type to the new `recipeBlock`. The shape is otherwise identical
// (paragraph · block · paragraph), so this is a pure rename.
//
// Idempotent: a doc already in the new shape passes through unchanged.
// Same pattern as migrateListSchema and migrateQASchema.
export function migrateRecipeSchema(doc) {
  if (!doc || typeof doc !== "object") return doc;
  return walk(doc);
}

function walk(node) {
  if (!node || typeof node !== "object") return node;
  let next = node;
  if (node.type === "algorithmBlock") {
    next = { ...node, type: "recipeBlock" };
  }
  if (Array.isArray(next.content)) {
    let changed = false;
    const mapped = next.content.map((child) => {
      const w = walk(child);
      if (w !== child) changed = true;
      return w;
    });
    if (changed || next !== node) {
      next = { ...next, content: mapped };
    }
  }
  return next;
}
