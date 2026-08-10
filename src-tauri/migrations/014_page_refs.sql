-- Backlinks index. Populated on every page-save by scanning the saved
-- content_json for `pageRef` nodes. Composite primary key dedupes if
-- the same page is referenced multiple times by the same source.
--
-- Cleanup: rows are deleted on page-save (replaced by the new scan) and
-- via cascade on page deletion. No FK to pages.id with ON DELETE CASCADE
-- because pages don't always cascade-delete in this app's lifecycle —
-- we rely on the per-save sweep instead.
CREATE TABLE IF NOT EXISTS page_refs (
    source_page_id TEXT NOT NULL,
    target_page_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (source_page_id, target_page_id)
);

CREATE INDEX IF NOT EXISTS idx_page_refs_target ON page_refs(target_page_id);
CREATE INDEX IF NOT EXISTS idx_page_refs_source ON page_refs(source_page_id);
