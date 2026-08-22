// Which identifier addresses a page?
//
// `page_number` is minted per device: `MAX(page_number) + 1` over the local
// table for that date. Two devices writing on the same day therefore both
// mint "page 1", and when the second one's create op merges,
// `insert_page_with_collision_resolution` renumbers it to whatever is free
// HERE — silently, and without emitting a correcting op. There is nothing
// wrong with that: `UNIQUE(date, page_number)` leaves no choice, and the
// number is a display artifact.
//
// What was wrong was using the number as an ADDRESS. Seen on a real account
// (2026-08-22): a page the phone called "page 1 of 22 august" was page 4 on
// the desktop. Every `getPage(date, page_number)` call is a pointer that
// resolves to a different page on each device — including "restore last
// page", which reopened by (date, number) and could land the user on
// someone else's page entirely.
//
// The id is a UUID, minted once, carried by the create op, and identical on
// every device. It is the only stable address a page has. `get_page`
// already prefers `page_id` when given one; these call sites simply never
// gave it one.
//
// Returns the argument triple for `getPage(date, pageNumber, pageId)`.
// (date, page_number) still travel so the legacy lookup stays available for
// rows that genuinely have no id — the backend ignores them whenever an id
// is present.
export function pageAddress(row) {
  if (!row || typeof row !== "object") return [null, null, null];
  const id = typeof row.id === "string" && row.id.trim() ? row.id : null;
  const date = typeof row.date === "string" && row.date ? row.date : null;
  const pageNumber = Number.isInteger(row.page_number) ? row.page_number : null;
  return [date, pageNumber, id];
}
