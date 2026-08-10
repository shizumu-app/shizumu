//! Phase 14: sync engine.
//!
//! Wires the silent op_log foundation (v0.3 / phase 13) to a
//! shizumu-relay over the wire protocol described in
//! `/home/dev/projects/shizumu-relay/2026-05-08-shizumu-relay-spec.md`.
//!
//! Phase 14 scope is single_user mode + enrollment + crypto envelope +
//! end-to-end round-trip. Multi-device pairing (QR + SAS) is phase 16.

pub mod config;
pub mod envelope;
pub mod epoch;
pub mod keys;
pub mod merge;
pub mod op_auth;
pub mod pair;
pub mod pull;
pub mod rotation;
pub mod secret_store;
pub mod signing;
pub mod upload;
pub mod wire;
pub mod worker;
pub mod yjs;
