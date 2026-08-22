-- Per-field HLC stamps for pages.
--
-- `applied_hlc_ts` (migration 018) is ONE last-write-wins stamp shared by
-- every field on the row: content_json, what_matters_now, what_shifted and
-- lineage_id. Every merge arm both gates on it and bumps it, so a newer op
-- touching ANY field permanently blocks an older op touching a DIFFERENT
-- one. The fields are independent; the stamp was not.
--
-- What that costs, seen on a real account (2026-08-22): a page arrives on
-- the second device with its body but no focus line and no trail, because a
-- content save happened to carry a higher HLC than the focus and trail ops
-- that followed it into the merge. The row then reads as empty and
-- untrailed, disappears from memory (`is_page_relevant`), and matches the
-- launch sweeper's delete criteria — so the next launch deletes it and
-- broadcasts a tombstone. Cross-field LWW turns a reordering into data loss.
--
-- One stamp per independently-written field. `applied_hlc_ts` stays, and
-- keeps its ROW-level meaning: the newest op applied to this page in any
-- field. Tombstone gates want exactly that and are left alone.
--
-- Backfill is deliberately asymmetric, and it is the interesting part:
--
--   * a field that HOLDS a value inherits `applied_hlc_ts`. Conservative:
--     whatever set it stays protected from an older op arriving late, so
--     upgrading cannot resurrect stale writing over newer state.
--   * a field that is EMPTY starts at 0, so the very op it never received
--     can still land. This is what lets an already-damaged row heal: a
--     device that lost a focus line or a trail assignment to the shared
--     stamp accepts it on the next replay instead of refusing it forever.
--
-- Backfilling everything to `applied_hlc_ts` would be safe but would freeze
-- existing damage in place; backfilling everything to 0 would heal it and
-- also re-open every page to genuinely superseded ops. The split gets the
-- repair without the regression.
ALTER TABLE pages ADD COLUMN hlc_content INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pages ADD COLUMN hlc_focus   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pages ADD COLUMN hlc_shifted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pages ADD COLUMN hlc_lineage INTEGER NOT NULL DEFAULT 0;

UPDATE pages SET hlc_content = applied_hlc_ts
 WHERE content_json IS NOT NULL AND trim(content_json) != '';
UPDATE pages SET hlc_focus = applied_hlc_ts
 WHERE what_matters_now IS NOT NULL AND trim(what_matters_now) != '';
UPDATE pages SET hlc_shifted = applied_hlc_ts
 WHERE what_shifted IS NOT NULL AND trim(what_shifted) != '';
UPDATE pages SET hlc_lineage = applied_hlc_ts
 WHERE lineage_id IS NOT NULL;
