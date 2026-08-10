/**
 * Get today's date as YYYY-MM-DD string using LOCAL time (not UTC).
 * The backend uses chrono::Local::now(), so the frontend must match.
 */
export function getLocalDateStr() {
  return formatLocalDate(new Date());
}

export function getYesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return formatLocalDate(d);
}

export function getWeekAgoStr() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return formatLocalDate(d);
}

export function getTwoWeeksAgoStr() {
  const d = new Date();
  d.setDate(d.getDate() - 14);
  return formatLocalDate(d);
}

export function formatLocalDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseContentJson(contentJson) {
  if (!contentJson) return null;
  try {
    const doc = typeof contentJson === "string" ? JSON.parse(contentJson) : contentJson;
    return doc && typeof doc === "object" ? doc : null;
  } catch {
    return null;
  }
}

export function contentJsonHasDayMarker(contentJson, date) {
  const doc = parseContentJson(contentJson);
  if (!doc || !Array.isArray(doc.content)) return false;
  return doc.content.some(
    (n) => n && n.type === "dayMarker" && n.attrs && n.attrs.date === date,
  );
}

// Mirrors Rust is_page_empty: the page counts as having real content when
// its TipTap doc yields any non-whitespace text. DayMarkers, empty paragraphs,
// and pure-whitespace runs don't count.
export function contentJsonHasRealContent(contentJson) {
  const doc = parseContentJson(contentJson);
  if (!doc) return false;
  const stack = [doc];
  while (stack.length) {
    const n = stack.pop();
    if (!n || typeof n !== "object") continue;
    if (typeof n.text === "string" && n.text.trim().length > 0) return true;
    if (Array.isArray(n.content)) {
      for (const child of n.content) stack.push(child);
    }
  }
  return false;
}

// Mirrors Rust is_page_relevant. A focus is "worth surfacing" when the user
// has invested any signal in it: trail attached, focus declared, body text,
// or saved lines. Untrailed empties stay out of the rail/memory/history.
export function isFocusRelevant(f) {
  if (!f) return false;
  if (f.lineage_id) return true;
  if (typeof f.what_matters_now === "string" && f.what_matters_now.trim().length > 0) {
    return true;
  }
  if (typeof f.line_count === "number" && f.line_count > 0) return true;
  return contentJsonHasRealContent(f.content_json);
}
