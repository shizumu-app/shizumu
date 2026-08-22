//! What the device list can know about a device without asking the relay.
//! The relay stores no last-seen time; the op log does, implicitly: every
//! received op carries the device that wrote it and when it was ingested.

use rusqlite::{params, Connection, OptionalExtension};

/// Newest `created_at` (ms) of any received op from this device, or None
/// when this device has never heard from it — which after a reinstall is
/// exactly the case for the OLD device id, and is the signal to revoke it.
pub fn last_seen_ms(conn: &Connection, device_id: &str) -> rusqlite::Result<Option<i64>> {
    conn.query_row(
        "SELECT MAX(created_at) FROM op_log WHERE device_id = ?1 AND state = 'received'",
        params![device_id],
        |r| r.get::<_, Option<i64>>(0),
    )
    .optional()
    .map(|o| o.flatten())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::test_db;

    #[test]
    fn last_seen_is_the_newest_received_op_from_that_device() {
        let db = test_db();
        let c = db.lock().unwrap();
        for (seq, dev, at) in [(1, "phone", 100), (2, "phone", 900), (3, "laptop", 500)] {
            c.execute(
                "INSERT INTO op_log (op_id, op_kind, payload_blob, hlc_ts, device_id, state, user_seq, applied_at, created_at)
                 VALUES (?, 'setting_op', X'00', 0, ?, 'received', ?, 0, ?)",
                params![format!("op-{seq}"), dev, seq, at],
            ).unwrap();
        }
        assert_eq!(last_seen_ms(&c, "phone").unwrap(), Some(900));
        assert_eq!(last_seen_ms(&c, "laptop").unwrap(), Some(500));
        // None, not Some(0): "never heard from" must be distinguishable from
        // "heard from at the epoch", because the UI says "never seen" for it.
        assert_eq!(last_seen_ms(&c, "ghost").unwrap(), None);
    }
}
