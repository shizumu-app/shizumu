//! Y-CRDT receive-side primitive.
//!
//! Exposes `apply_update` — the merge handler in `crate::sync::merge`
//! calls it whenever a `page_yjs` op arrives. yjs updates are CRDTs,
//! so applying the same update set in any order produces the same
//! final state (the convergence property tested below). Storage
//! format is opaque bytes — the v2 encoding produced by
//! `Doc::transact().encode_state_as_update_v2()`.
//!
//! The send side lives in `crate::commands::emit_page_op` →
//! `crate::op_log::emit_page_yjs`, gated on the `enable_yjs` setting
//! (on by default; only continuous-trail pages route through here).

use yrs::{updates::decoder::Decode, Doc, ReadTxn, StateVector, Transact, Update};

/// Apply an incoming update to a yjs Doc reconstructed from
/// `prior_state` (or a fresh Doc if `prior_state` is `None`). Returns
/// the merged state as a v2 update — callers persist these bytes
/// alongside the page row (the schema column lands when the emit side
/// migrates to yjs).
///
/// The yjs 0.20 API exposes `apply_update` as an infallible operation
/// (returns ()) — only the Update decode step can fail, which we
/// surface as a String error so the merge handler can log + skip.
pub fn apply_update(
    prior_state: Option<&[u8]>,
    update_bytes: &[u8],
) -> Result<Vec<u8>, String> {
    let doc = Doc::new();
    if let Some(prior) = prior_state {
        let mut txn = doc.transact_mut();
        let update =
            Update::decode_v2(prior).map_err(|e| format!("prior state decode: {e}"))?;
        txn.apply_update(update);
    }
    {
        let mut txn = doc.transact_mut();
        let update =
            Update::decode_v2(update_bytes).map_err(|e| format!("update decode: {e}"))?;
        txn.apply_update(update);
    }
    let txn = doc.transact();
    Ok(txn.encode_state_as_update_v2(&StateVector::default()))
}

/// Encode a fresh Doc's state as a v2 update — used in tests to
/// produce a non-empty initial state.
#[cfg(test)]
pub fn encode_doc_state(doc: &Doc) -> Vec<u8> {
    doc.transact().encode_state_as_update_v2(&StateVector::default())
}

#[cfg(test)]
mod tests {
    use super::*;
    use yrs::{GetString, Text};

    /// A fresh Doc + one text insert encoded as a v2 update re-applies
    /// cleanly to produce a Doc with the same text. Smoke check that
    /// the encode/decode round-trips.
    #[test]
    fn single_update_round_trips() {
        let doc1 = Doc::new();
        let text = doc1.get_or_insert_text("body");
        {
            let mut txn = doc1.transact_mut();
            text.insert(&mut txn, 0, "hello");
        }
        let update = encode_doc_state(&doc1);

        let merged = apply_update(None, &update).unwrap();
        let doc2 = Doc::new();
        {
            let mut txn = doc2.transact_mut();
            let u = Update::decode_v2(&merged).unwrap();
            txn.apply_update(u);
        }
        let text2 = doc2.get_or_insert_text("body");
        assert_eq!(text2.get_string(&doc2.transact()), "hello");
    }

    /// CRDT convergence: applying updates in different orders
    /// produces the same final state. This is the load-bearing
    /// property of yjs — without it, multi-device sync diverges.
    #[test]
    fn updates_converge_regardless_of_order() {
        let origin = Doc::new();
        let t = origin.get_or_insert_text("body");
        {
            let mut tx = origin.transact_mut();
            t.insert(&mut tx, 0, "hello");
        }
        let base = encode_doc_state(&origin);

        let doc_a = Doc::new();
        {
            let mut tx = doc_a.transact_mut();
            tx.apply_update(Update::decode_v2(&base).unwrap());
        }
        let ta = doc_a.get_or_insert_text("body");
        {
            let mut tx = doc_a.transact_mut();
            ta.insert(&mut tx, 5, " world");
        }
        let update_a = encode_doc_state(&doc_a);

        let doc_b = Doc::new();
        {
            let mut tx = doc_b.transact_mut();
            tx.apply_update(Update::decode_v2(&base).unwrap());
        }
        let tb = doc_b.get_or_insert_text("body");
        {
            let mut tx = doc_b.transact_mut();
            tb.insert(&mut tx, 0, "say: ");
        }
        let update_b = encode_doc_state(&doc_b);

        let merged_ab = apply_update(Some(&update_a), &update_b).unwrap();
        let merged_ba = apply_update(Some(&update_b), &update_a).unwrap();

        let final_a = Doc::new();
        {
            let mut tx = final_a.transact_mut();
            tx.apply_update(Update::decode_v2(&merged_ab).unwrap());
        }
        let final_b = Doc::new();
        {
            let mut tx = final_b.transact_mut();
            tx.apply_update(Update::decode_v2(&merged_ba).unwrap());
        }
        let text_a = final_a.get_or_insert_text("body");
        let text_b = final_b.get_or_insert_text("body");
        let s_a = text_a.get_string(&final_a.transact());
        let s_b = text_b.get_string(&final_b.transact());
        assert_eq!(s_a, s_b, "yjs CRDT must converge regardless of order");
    }

    /// Garbage update bytes return an Err — the merge handler logs
    /// and the pull loop keeps moving rather than crashing.
    #[test]
    fn malformed_update_returns_err() {
        let result = apply_update(None, b"\x00\x01\x02\x03");
        assert!(result.is_err());
    }

    /// Empty prior_state slice is rejected — None means "no prior",
    /// empty bytes means corruption.
    #[test]
    fn empty_prior_state_fails() {
        let doc = Doc::new();
        let t = doc.get_or_insert_text("x");
        {
            let mut tx = doc.transact_mut();
            t.insert(&mut tx, 0, "ok");
        }
        let valid = encode_doc_state(&doc);
        assert!(apply_update(Some(&[]), &valid).is_err());
    }
}
