-- Phase 14.17: receive-side HLC gating.
--
-- Every row that can be mutated by a remote op tracks the highest HLC
-- of an op that has successfully applied to it. The merge handlers
-- gate writes by `applied_hlc_ts < <incoming op's hlc_ts>` so a
-- late-arriving older op cannot overwrite newer state. Local writes
-- stamp the same column via `op_log/dispatch.rs::stamp_applied_hlc`
-- (called from `OpLogEngine::apply`) so the gate stays symmetric for
-- both directions.
--
-- Default 0: every emitted HLC is strictly positive (physical_ms is
-- ms since the unix epoch), so existing rows pass any incoming op's
-- gate on first arrival. No backfill across pre-existing op_log
-- history — v0.4 is pre-release single-user, the cost isn't worth it.

ALTER TABLE pages          ADD COLUMN applied_hlc_ts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lineages       ADD COLUMN applied_hlc_ts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shared_objects ADD COLUMN applied_hlc_ts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE settings       ADD COLUMN applied_hlc_ts INTEGER NOT NULL DEFAULT 0;
