//! Inline file attachments. Generic over kind (v0.4 ships `file` only);
//! per-attachment sync toggle. Local blob store is content-addressed.
//! Sync uses the existing op_log pipeline via a new `attachment_blob`
//! op_kind defined in `sync::wire::attachment_blob`.
pub mod store;
pub mod commands;
pub mod backfill;
pub mod share;
