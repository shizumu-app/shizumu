-- Trail modes: continuous (one living document) vs discrete (separate pages)
ALTER TABLE lineages ADD COLUMN mode TEXT NOT NULL DEFAULT 'discrete';

-- Hierarchical trails: parent_id links child trails to parent trails
ALTER TABLE lineages ADD COLUMN parent_id TEXT REFERENCES lineages(id);
CREATE INDEX IF NOT EXISTS idx_lineages_parent_id ON lineages(parent_id);
