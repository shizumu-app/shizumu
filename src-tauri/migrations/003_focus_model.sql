-- Add focus model columns to existing pages table
-- parent_id: links this focus to a parent focus from a previous day (@lineage)
-- is_open: 1 = open (writable), 0 = closed (read-only, "what shifted" was written)
ALTER TABLE pages ADD COLUMN parent_id TEXT REFERENCES pages(id);
ALTER TABLE pages ADD COLUMN is_open INTEGER DEFAULT 1;

-- Backfill: existing pages with what_shifted_complete=1 become closed
UPDATE pages SET is_open = 0 WHERE what_shifted_complete = 1;

-- Index for lineage queries (find children of a focus)
CREATE INDEX IF NOT EXISTS idx_pages_parent_id ON pages(parent_id);

-- Index for open focuses queries
CREATE INDEX IF NOT EXISTS idx_pages_is_open ON pages(is_open);
