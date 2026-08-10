-- pinRef backlinks index. Populated on every page-save by walking the
-- saved content_json for `pinRef` nodes. Mirrors `page_refs` (migration
-- 014) shape so the per-save hook is symmetric: same DELETE-then-INSERT
-- sweep, same composite primary key for natural dedupe.
--
-- A page that contains three @-mentions of the same pin produces a
-- single (source_page_id, target_pin_id) row — exactly the user's
-- mental model: "this page references that pin," not "this page
-- references that pin three times."
CREATE TABLE IF NOT EXISTS pin_refs (
    source_page_id TEXT NOT NULL,
    target_pin_id  TEXT NOT NULL,
    created_at     TEXT NOT NULL,
    PRIMARY KEY (source_page_id, target_pin_id)
);

CREATE INDEX IF NOT EXISTS idx_pin_refs_target ON pin_refs(target_pin_id);
CREATE INDEX IF NOT EXISTS idx_pin_refs_source ON pin_refs(source_page_id);
