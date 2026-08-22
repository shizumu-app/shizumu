// Which number does a page show in the rail?
//
// Not page_number. That column is minted per device (MAX+1 over the local
// table for the date) and renumbered on collision when ops merge, so the same
// page is 1 on the phone and 4 on the desktop. The rail already sorts by
// created_at, which is HLC-derived and identical everywhere; the only label
// that agrees across devices is the position in that order.
export function withOrdinals(focuses) {
  if (!Array.isArray(focuses)) return [];
  return focuses.map((f, i) => ({ ...f, ordinal: i + 1 }));
}

export function ordinalOf(focuses, pageId) {
  if (!Array.isArray(focuses) || !pageId) return 0;
  const i = focuses.findIndex((f) => f && f.id === pageId);
  return i === -1 ? 0 : i + 1;
}
