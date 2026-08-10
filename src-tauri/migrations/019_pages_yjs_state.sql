-- Phase 14.18: yjs storage column for pages.
--
-- Continuous-trail pages will eventually store their CRDT state as
-- the binary v2 update encoding produced by Yrs's
-- `encode_state_as_update_v2`. The column is NULLable because:
--   * discrete-trail pages never use yjs — content_json is the source
--     of truth and yjs_state stays NULL forever
--   * continuous-trail pages start with yjs_state = NULL and gain it
--     on their first received page_yjs op, OR on their first local
--     yjs emit (which lands in phase 14.19)
--
-- Receive-side merge is now real. merge_page_yjs reads the prior
-- yjs_state, folds the incoming update via sync::yjs::apply_update,
-- and writes the merged bytes back. Phase 14.16 landed the receive
-- primitive but discarded the result for lack of a column. 14.18 is
-- the storage that closes the loop. Send-side migration (computing
-- deltas instead of full content_json flushes) is the next phase,
-- 14.19.

ALTER TABLE pages ADD COLUMN yjs_state BLOB;
