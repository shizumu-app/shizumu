//! Phase 14: sync engine.
//!
//! Wires the silent op_log foundation (v0.3 / phase 13) to a
//! shizumu-relay over the wire protocol described in
//! `/home/dev/projects/shizumu-relay/2026-05-08-shizumu-relay-spec.md`.
//!
//! Phase 14 scope is single_user mode + enrollment + crypto envelope +
//! end-to-end round-trip. Multi-device pairing (QR + SAS) is phase 16.

pub mod config;
pub mod device_view;
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
pub mod snapshot;
pub mod upload;
pub mod wire;
pub mod worker;
pub mod yjs;

// Shared test fixture: called from the snapshot, pull, and worker test
// modules wherever a test needs a real keypair without caring whose.
#[cfg(test)]
#[allow(dead_code)]
pub(crate) fn test_keys() -> (crate::sync::keys::UserKeys, crate::sync::keys::DeviceKeys) {
    // Same three calls the worker tests make inline (worker.rs ~1273):
    // a fresh phrase, its epoch-0 user keys, and a fresh device keypair.
    let m = crate::sync::keys::generate_seed_phrase();
    let uk = crate::sync::keys::user_keys_from_phrase(&m);
    let dk = crate::sync::keys::generate_device_keys();
    (uk, dk)
}
