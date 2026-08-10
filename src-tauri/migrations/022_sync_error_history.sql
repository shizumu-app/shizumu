-- Sync error history. Day-5 status-pill push-on-error: the pill
-- already shows the latest error inline via sync_state.last_error;
-- this table lets the pill open a small popover listing the last N
-- errors so users can spot patterns (rate-limited every 30s vs.
-- single decrypt failure) without scraping the app log.
--
-- Rows are inserted from sync::config::mark_sync_error and capped at
-- 50 to keep the table bounded — the popover only ever shows the
-- most recent handful, and we don't want a long-running broken
-- relay to grow the DB without bound.
CREATE TABLE IF NOT EXISTS sync_error_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    error_at_ms INTEGER NOT NULL,
    error_kind TEXT NOT NULL,
    error_message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sync_error_history_recent
    ON sync_error_history(error_at_ms DESC);
