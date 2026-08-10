use rusqlite::{params, Connection, OptionalExtension};
use std::sync::Mutex;

/// Hybrid Logical Clock state — wall-clock milliseconds plus a logical
/// counter that breaks ties when multiple ops are emitted inside the
/// same millisecond or when the wall clock moves backward.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Hlc {
    pub physical_ms: u64,
    pub logical: u32,
}

impl Hlc {
    /// Pack `(physical_ms, logical)` into a single `i64` suitable for the
    /// `op_log.hlc_ts` column. Layout: `physical_ms << 16 | logical`.
    /// Logical is masked to 16 bits — at 65k ops/ms we're already five
    /// orders of magnitude past sane.
    pub fn pack(self) -> i64 {
        ((self.physical_ms as i64) << 16) | (self.logical as i64 & 0xFFFF)
    }

    pub fn unpack(packed: i64) -> Self {
        Self {
            physical_ms: (packed >> 16) as u64,
            logical: (packed & 0xFFFF) as u32,
        }
    }
}

/// Thread-safe HLC generator backed by the `hlc_state` row in SQLite.
///
/// `load` reads the persisted high-water mark; `next` advances it and
/// writes the new state back. The write is synchronous on purpose —
/// duplicate (physical_ms, logical) pairs after a crash would corrupt
/// the relay's ordering guarantees once v0.4 wire ops land. The async
/// writer pool (13.3) will batch op_log INSERTs around it, not replace
/// the HLC durability semantics.
pub struct HlcGenerator {
    last: Mutex<Hlc>,
}

impl HlcGenerator {
    pub fn load(conn: &Connection) -> rusqlite::Result<Self> {
        let row = conn
            .query_row(
                "SELECT physical_ms, logical FROM hlc_state WHERE id = 1",
                [],
                |r| {
                    Ok(Hlc {
                        physical_ms: r.get::<_, i64>(0)? as u64,
                        logical: r.get::<_, i64>(1)? as u32,
                    })
                },
            )
            .optional()?;
        let last = row.unwrap_or(Hlc {
            physical_ms: 0,
            logical: 0,
        });
        Ok(Self {
            last: Mutex::new(last),
        })
    }

    pub fn next(&self, conn: &Connection) -> rusqlite::Result<Hlc> {
        self.next_at(conn, wall_clock_ms())
    }

    /// Test seam: `next_at` lets unit tests inject a wall-clock value
    /// so we can verify monotonicity when the clock moves backward.
    pub fn next_at(&self, conn: &Connection, now_ms: u64) -> rusqlite::Result<Hlc> {
        let mut guard = self.last.lock().expect("hlc mutex poisoned");
        let next = if now_ms > guard.physical_ms {
            Hlc {
                physical_ms: now_ms,
                logical: 0,
            }
        } else {
            Hlc {
                physical_ms: guard.physical_ms,
                logical: guard.logical.saturating_add(1),
            }
        };
        conn.execute(
            "INSERT INTO hlc_state(id, physical_ms, logical) VALUES (1, ?, ?)
             ON CONFLICT(id) DO UPDATE SET physical_ms = excluded.physical_ms,
                                           logical     = excluded.logical",
            params![next.physical_ms as i64, next.logical as i64],
        )?;
        *guard = next;
        Ok(next)
    }
}

fn wall_clock_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE hlc_state (
                 id          INTEGER PRIMARY KEY CHECK (id = 1),
                 physical_ms INTEGER NOT NULL,
                 logical     INTEGER NOT NULL
             )",
        )
        .unwrap();
        conn
    }

    #[test]
    fn pack_round_trip() {
        let h = Hlc {
            physical_ms: 1_700_000_000_123,
            logical: 7,
        };
        assert_eq!(Hlc::unpack(h.pack()), h);
    }

    #[test]
    fn logical_increments_when_wall_clock_stalls() {
        let conn = fresh_conn();
        let gen = HlcGenerator::load(&conn).unwrap();
        let a = gen.next_at(&conn, 1000).unwrap();
        let b = gen.next_at(&conn, 1000).unwrap();
        let c = gen.next_at(&conn, 1000).unwrap();
        assert_eq!(a, Hlc { physical_ms: 1000, logical: 0 });
        assert_eq!(b, Hlc { physical_ms: 1000, logical: 1 });
        assert_eq!(c, Hlc { physical_ms: 1000, logical: 2 });
    }

    #[test]
    fn physical_resets_logical_when_clock_advances() {
        let conn = fresh_conn();
        let gen = HlcGenerator::load(&conn).unwrap();
        let _ = gen.next_at(&conn, 1000).unwrap();
        let _ = gen.next_at(&conn, 1000).unwrap();
        let advanced = gen.next_at(&conn, 2000).unwrap();
        assert_eq!(advanced, Hlc { physical_ms: 2000, logical: 0 });
    }

    #[test]
    fn backward_wall_clock_does_not_regress_hlc() {
        let conn = fresh_conn();
        let gen = HlcGenerator::load(&conn).unwrap();
        let high = gen.next_at(&conn, 5000).unwrap();
        // Wall clock jumps backward (NTP skew, container clock reset).
        let after = gen.next_at(&conn, 1000).unwrap();
        assert_eq!(after.physical_ms, high.physical_ms);
        assert_eq!(after.logical, 1);
    }

    #[test]
    fn pack_strictly_monotonic_for_consecutive_emissions() {
        let conn = fresh_conn();
        let gen = HlcGenerator::load(&conn).unwrap();
        let mut prev = i64::MIN;
        for ms in [100, 100, 100, 200, 50, 50, 300] {
            let packed = gen.next_at(&conn, ms).unwrap().pack();
            assert!(packed > prev, "hlc must be strictly monotonic");
            prev = packed;
        }
    }

    #[test]
    fn state_persists_across_load() {
        let conn = fresh_conn();
        {
            let gen = HlcGenerator::load(&conn).unwrap();
            let _ = gen.next_at(&conn, 9000).unwrap();
            let _ = gen.next_at(&conn, 9000).unwrap();
        }
        // Reload — the next emission must not regress.
        let gen2 = HlcGenerator::load(&conn).unwrap();
        let next = gen2.next_at(&conn, 9000).unwrap();
        assert_eq!(next, Hlc { physical_ms: 9000, logical: 2 });
    }
}
