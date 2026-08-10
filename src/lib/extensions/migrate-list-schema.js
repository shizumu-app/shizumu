// Lazy migration from the legacy three-container list schema
// (taskList / bulletList / orderedList + taskItem / listItem) to the unified
// (list + listItem with marker attr) schema. Runs on the JSON blob when a
// page loads, before TipTap parses it. Idempotent — running twice on
// already-migrated JSON is a no-op since the legacy type names no longer
// appear in the input. Save side writes the new schema, so over time pages
// migrate themselves without any blocking startup work.

const LEGACY_LIST_TYPES = new Set(["taskList", "bulletList", "orderedList"]);

export function migrateListSchema(json) {
  if (json === null || json === undefined) return json;
  if (Array.isArray(json)) return json.map(migrateListSchema);
  if (typeof json !== "object") return json;

  if (LEGACY_LIST_TYPES.has(json.type)) {
    return {
      ...json,
      type: "list",
      // Drop legacy container attrs (taskList itemTypeName, orderedList start) —
      // the unified list has no per-container attrs; ordering numerals come
      // from per-item marker="ordered" + CSS counter.
      attrs: stripLegacyContainerAttrs(json.attrs),
      content: (json.content || []).map(migrateListSchema),
    };
  }

  if (json.type === "taskItem") {
    const checked = !!json.attrs?.checked;
    const { checked: _drop, ...restAttrs } = json.attrs || {};
    return {
      type: "listItem",
      attrs: { ...restAttrs, marker: "task", checked },
      content: (json.content || []).map(migrateListSchema),
    };
  }

  if (json.type === "listItem") {
    // Already a listItem — fill in defaults so legacy items missing the
    // marker attr get one. Don't clobber an existing marker.
    return {
      ...json,
      attrs: { marker: "bullet", checked: false, ...(json.attrs || {}) },
      content: (json.content || []).map(migrateListSchema),
    };
  }

  if (json.content) {
    return { ...json, content: json.content.map(migrateListSchema) };
  }
  return json;
}

function stripLegacyContainerAttrs(attrs) {
  if (!attrs) return undefined;
  const { itemTypeName: _i, start: _s, ...rest } = attrs;
  return Object.keys(rest).length > 0 ? rest : undefined;
}
