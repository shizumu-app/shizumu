//! Background sync worker: runs one upload pass + one pull pass on a
//! timer. Polling, not SSE — the spec's `/live` endpoint is intentionally
//! out of scope for v0.4 (see ADR in the phase-14 plan). A 30-second
//! interval covers the single-device bake; multi-device latency is a
//! phase-16 concern when pairing lands.
//!
//! NOT wired into lib.rs in this commit. Phase 14.8 will spawn the
//! worker alongside the existing op_log background thread, gated on
//! cfg.is_active() and a fresh sync::keys snapshot from sync_keys.

use crate::db::Db;
use crate::sync::config;
use crate::sync::keys::{DeviceKeys, UserKeys};
use crate::sync::wire::WireError;
use crate::sync::{pull, upload};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Default polling interval. Tuned so the worker doesn't hammer the
/// relay during a quiet bake and doesn't lag visibly when the user
/// switches devices.
pub const DEFAULT_TICK: Duration = Duration::from_secs(30);

/// Floor for the exponential-backoff schedule after a wire failure.
/// One second matches the SSE listener's existing schedule so both
/// channels respond to a relay flap on the same heartbeat.
pub const MIN_BACKOFF: Duration = Duration::from_secs(1);
/// Ceiling for the exponential-backoff schedule. Five minutes per
/// arch spec §8.557 ("1s → 5min"). At the ceiling the worker still
/// retries — it just spaces attempts out so a long outage doesn't
/// hammer the relay.
pub const MAX_BACKOFF: Duration = Duration::from_secs(300);

/// The relay embeds this literal in every auth rejection for a revoked
/// device (relay auth.rs), and the live channel's closed event carries it
/// as a reason. String-level match on purpose: it must catch the message
/// wherever in the error chain it appears.
pub fn is_device_revoked_err(msg: &str) -> bool {
    msg.contains("device_revoked")
}

/// True once this session has completed one successful pull pass. The
/// launch-time orphan sweeper refuses to run before that when sync is
/// enabled: a just-synced page is empty until its content ops merge, and
/// sweeping it broadcasts a tombstone that destroys the other device's
/// writes (observed: 24 parked page_blob ops after seq-180 GC tombstone).
///
/// Process-global, not per-connection or per-test: `cargo test` runs test
/// functions in parallel threads within one process, so any future test
/// that combines `sync::config::set_enabled(&conn, true)` with
/// `cleanup_orphan_pages_inner` must explicitly reset this flag
/// (`FIRST_PULL_DONE.store(false, Ordering::SeqCst)`) at its own start
/// rather than assume the default `false` — another test in the same run
/// may have already flipped it to `true`.
pub static FIRST_PULL_DONE: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Runs the launch-time orphan sweep exactly once — on the false→true
/// transition of `flag`. `swap` both flips the flag and reports its
/// previous value atomically, so this fires exactly once per process
/// even if two callers raced here, and it fires deterministically at the
/// tick a pull first succeeds — rather than depending on the frontend's
/// mount-time call having already run (which may itself have raced the
/// first pull and skipped, per `cleanup_orphan_pages_inner`'s own race
/// guard, and prior to this fix nothing retried it for the rest of the
/// session).
///
/// Factored out of `tick()`'s pull-success arm — where `db` and `engine`
/// are both already in scope — so the transition logic can be exercised
/// against a private `AtomicBool` in tests instead of the process-global
/// `FIRST_PULL_DONE`. `FIRST_PULL_DONE` is shared across every test in
/// the binary (`cargo test` runs test fns in parallel threads within one
/// process — see the flag's own doc comment above), and this transition
/// involves real wall-clock time in production callers (a live pull just
/// completed over HTTP); an integration test that resets the global flag
/// and then calls through a mocked `tick()` has an open window for
/// concurrently-running tests' own successful ticks to flip the shared
/// flag first, making the assertion flaky under the full parallel suite.
/// Testing this helper directly with a scoped `AtomicBool` removes that
/// window entirely while still proving the transition logic itself.
fn sweep_on_first_pull_transition(
    flag: &std::sync::atomic::AtomicBool,
    db: &Db,
    engine: &crate::op_log::OpLog,
) {
    if !flag.swap(true, Ordering::SeqCst) {
        match crate::commands::cleanup_orphan_pages_inner(db, engine) {
            Ok(n) if n > 0 => {
                log::info!("sync tick: first-pull orphan sweep removed {n} page(s)")
            }
            Ok(_) => {}
            Err(e) => log::warn!("sync tick: first-pull orphan sweep failed: {e}"),
        }
    }
}

/// Outcome of one `tick()` call. Replaces the old `bool` return so
/// the worker loop can branch on wire failures and honour
/// `Retry-After` hints (the `Throttled` variant of `WireError`).
#[derive(Debug, Clone)]
pub enum TickOutcome {
    /// Tick ran a full upload + pull pass without surfacing a wire
    /// error. `did_work` mirrors the old return: true if upload or
    /// pull moved any rows. `ops_received` counts how many remote ops
    /// were merged into local tables this tick.
    Ok { did_work: bool, ops_received: usize },
    /// At least one wire pass failed. `retry_after` is the relay's
    /// `Retry-After` hint for 429s; otherwise None and the worker
    /// falls back to its exponential schedule. `error_message` carries
    /// the stringified upload / pull error so the worker loop can
    /// classify it (e.g. for quota-specific callbacks) without
    /// re-reading sync_state from disk.
    WireFailure {
        retry_after: Option<Duration>,
        error_message: Option<String>,
    },
    /// No tick ran — sync was inactive or the db mutex was poisoned.
    /// Worker doesn't penalize the backoff in this case.
    Skipped,
}

/// In-memory backoff state for the polling worker. Held inside the
/// spawn closure; resets to MIN_BACKOFF on every successful tick and
/// doubles (capped at MAX_BACKOFF) on every wire failure. Process
/// restart wipes the backoff — by design: a restart is a chance to
/// retry without waiting out the previous schedule.
#[derive(Debug)]
struct Backoff {
    /// Wall-clock instant before which the worker should not run a
    /// tick. `None` means no penalty is in force.
    until: Option<Instant>,
    /// Current step in the exponential schedule. Used to compute
    /// `until` when the relay didn't supply a Retry-After.
    current: Duration,
}

impl Backoff {
    fn new() -> Self {
        Self {
            until: None,
            current: MIN_BACKOFF,
        }
    }

    /// True iff the worker should skip this iteration of the loop.
    fn should_skip(&self, now: Instant) -> bool {
        match self.until {
            Some(t) => now < t,
            None => false,
        }
    }

    /// Record a wire failure. If `retry_after` is set the worker
    /// honours it verbatim; otherwise we advance the exponential
    /// schedule.
    fn record_failure(&mut self, now: Instant, retry_after: Option<Duration>) {
        let delay = match retry_after {
            Some(d) => d.min(MAX_BACKOFF),
            None => {
                let next = (self.current * 2).min(MAX_BACKOFF);
                self.current = next;
                next
            }
        };
        self.until = Some(now + delay);
    }

    /// Successful tick clears the penalty and resets the schedule.
    fn record_success(&mut self) {
        self.until = None;
        self.current = MIN_BACKOFF;
    }
}

/// Run a single sync tick: one upload pass, then one pull pass. Wire
/// errors are logged but do not propagate — the worker should keep
/// trying on the next tick (the relay might just be briefly down).
///
/// Returns a `TickOutcome` so the worker loop can drive its backoff
/// schedule. `WireFailure` carries the relay's `Retry-After` hint
/// when present (parsed from 429 responses); the loop honours that
/// duration instead of its exponential default.
/// Set once this device's kex pubkey is confirmed published to the relay
/// (key rotation plan 1). Only set on success, so a transient/offline
/// failure retries on the next tick.
static KEX_BACKFILL_DONE: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Set once this device has published the account's phrase-recovery pubkey
/// (or determined it holds no phrase to publish). Key rotation plan 6.
static RECOVERY_KEY_PUBLISHED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

pub fn tick(
    db: &Db,
    user_keys: &UserKeys,
    device_keys: &DeviceKeys,
    engine: &crate::op_log::OpLog,
) -> TickOutcome {
    // v0.4 NOTE: this tick used to hold the global DB mutex end-to-end,
    // including across all the HTTP calls in upload/pull. That blocked
    // every UI command for as long as the relay took to respond. The
    // refactor below scopes every DB touch in a short-lived lock and
    // pushes the lock acquisition INTO upload::run_pass / pull::run_pass,
    // which release the lock around their own HTTP work.
    let cfg = {
        let conn = match db.lock() {
            Ok(c) => c,
            Err(e) => {
                log::warn!("sync tick: db mutex poisoned: {e}");
                return TickOutcome::Skipped;
            }
        };
        match config::load(&conn) {
            Ok(c) => c,
            Err(e) => {
                log::warn!("sync tick: config load failed: {e}");
                return TickOutcome::Skipped;
            }
        }
    };
    if !cfg.is_active() {
        return TickOutcome::Skipped;
    }

    // Key rotation plan 1: publish this device's X25519 kex pubkey once
    // (legacy/paired devices enroll without it). Best-effort, off the
    // critical path — a failure just defers to the next tick and never
    // affects upload/pull outcome.
    if !KEX_BACKFILL_DONE.load(std::sync::atomic::Ordering::Relaxed) {
        if let (Some(base), Some(uid)) = (cfg.relay_url.clone(), cfg.user_id.clone()) {
            match crate::sync::wire::devices::backfill_device_kex_if_needed(&base, device_keys, &uid) {
                Ok(_) => KEX_BACKFILL_DONE.store(true, std::sync::atomic::Ordering::Relaxed),
                Err(e) => log::warn!("sync tick: device kex backfill deferred: {e}"),
            }
        }
    }

    // Publish the account's phrase-recovery pubkey once, from a device that
    // holds the phrase (key rotation plan 6) — so rotations can wrap epoch
    // secrets to it and the phrase can recover post-rotation epochs. A device
    // without the phrase has nothing to publish and marks itself done.
    if !RECOVERY_KEY_PUBLISHED.load(std::sync::atomic::Ordering::Relaxed) {
        if let (Some(base), Some(uid)) = (cfg.relay_url.clone(), cfg.user_id.clone()) {
            match crate::sync::epoch::recovery_kex_pub_from_stored_phrase() {
                Ok(Some(pub_bytes)) => {
                    use base64::Engine;
                    let b64 = base64::engine::general_purpose::STANDARD.encode(pub_bytes);
                    match crate::sync::wire::epochs::put_recovery_key(&base, device_keys, &uid, &b64)
                    {
                        Ok(_) => RECOVERY_KEY_PUBLISHED
                            .store(true, std::sync::atomic::Ordering::Relaxed),
                        Err(e) => log::warn!("sync tick: recovery key publish deferred: {e}"),
                    }
                }
                // No phrase on this device (paired) — nothing to publish.
                Ok(None) => {
                    RECOVERY_KEY_PUBLISHED.store(true, std::sync::atomic::Ordering::Relaxed)
                }
                Err(e) => log::warn!("sync tick: recovery key derive failed: {e}"),
            }
        }
    }

    // Pick up any key rotation a peer device published: fetch + unwrap this
    // device's wrapped epoch secrets so it can decrypt and emit new-epoch
    // ops (key rotation plan 4). Best-effort, off the critical path.
    if let (Some(base), Some(uid)) = (cfg.relay_url.clone(), cfg.user_id.clone()) {
        match crate::sync::rotation::fetch_and_store_epoch_keys(db, device_keys, &base, &uid) {
            Ok(n) if n > 0 => log::info!("sync tick: adopted {n} new epoch key(s)"),
            Ok(_) => {}
            Err(e) => log::warn!("sync tick: epoch key fetch deferred: {e}"),
        }
    }

    // TODO(0.4.1, mobile): gate the tick on the user's mobile-awareness
    // preferences before doing any wire work. The two settings already
    // surface in SyncSettings.svelte and persist via set_setting:
    //   - sync_pause_on_metered ("true" / "false") — skip when the
    //     active connection reports a metered cost. On Linux that's
    //     NetworkManager's `Metered` property via D-Bus; on Android
    //     it's ConnectivityManager; on iOS it's NWPathMonitor.
    //   - sync_battery_threshold (i32, 0-100) — skip when the device
    //     battery is at or below this percent AND not charging. On
    //     Linux that's UPower's `Percentage` + `State` properties;
    //     mobile OSes expose equivalent APIs.
    // Returning TickOutcome::Skipped (not WireFailure) keeps the backoff
    // schedule clean — these are user-chosen pauses, not relay errors.
    // See docs/v0.4-sync-mobile.md for the cross-platform plan.

    let mut did_work = false;
    let mut ops_received: usize = 0;
    let mut wire_failure: Option<Option<Duration>> = None;
    let mut wire_error_message: Option<String> = None;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    // Replay previously-failed merges first. Transient failures
    // (e.g. an op that arrived before its dependency, or a row
    // briefly locked by a concurrent write) self-heal here without
    // any user intervention. A recovered op clears its merge_error
    // and lets the pull cursor advance past it on the next pass.
    // Pure DB work — short lock is fine.
    let replay_result = {
        let conn = match db.lock() {
            Ok(c) => c,
            Err(e) => {
                log::warn!("sync tick: db mutex poisoned during replay: {e}");
                return TickOutcome::Skipped;
            }
        };
        pull::replay_failed_merges(&conn)
    };
    match replay_result {
        Ok(0) => {}
        Ok(n) => {
            log::info!("sync replay: recovered {n} previously-failed merge(s)");
            did_work = true;
            // A replayed merge changed local tables just like a fresh pull, so
            // count it toward ops_received. Otherwise on_pull never fires for
            // replay-only ticks and the UI shows stale content: a new page
            // whose first merge failed (its epoch key adopts a tick later) is
            // recovered here but stays invisible until the user navigates away
            // and back.
            ops_received += n;
        }
        Err(e) => log::warn!("sync replay: {e}"),
    }

    // Attachment objects OUT, before the op upload pass — not after.
    //
    // This is the half of the out-of-band move that no earlier task
    // wired: `put_attachment` existed with zero callers, so every
    // attachment emitted a reference op pointing at an object that was
    // never uploaded, and peers sat at has_local = 0 forever. The sweep
    // uploads the object and only then emits the reference op, so
    // running it here means `upload::run_pass` below carries that op to
    // the relay in the same tick — the object always lands first, and
    // the pointer to it follows within milliseconds.
    //
    // `pending_object_upload` is a plain DB read (no network): a quiet
    // tick does zero HTTP calls here and never sets `did_work`, so it
    // can't perturb the worker's backoff schedule. Failures are logged,
    // not fed into the wire-failure path — `object_upload_with` already
    // leaves a failed row pending and unemitted, which is the retry.
    match crate::attachments::backfill::pending_object_upload(db) {
        Ok(pending) if !pending.is_empty() => {
            if let (Some(base_url), Some(user_id), Some(app_dir)) = (
                cfg.relay_url.clone(),
                cfg.user_id.clone(),
                app_data_dir_from_db(db),
            ) {
                match crate::attachments::backfill::run_object_upload_at(
                    db,
                    &app_dir,
                    &base_url,
                    &user_id,
                    device_keys,
                    user_keys,
                    engine,
                ) {
                    Ok(0) => {}
                    Ok(n) => {
                        log::info!("sync tick: uploaded {n} attachment object(s)");
                        did_work = true;
                    }
                    Err(e) => log::warn!("sync tick: object upload failed: {e}"),
                }
            }
        }
        Ok(_) => {}
        Err(e) => log::warn!("sync tick: pending_object_upload check failed: {e}"),
    }

    match upload::run_pass(db, &cfg, user_keys, device_keys) {
        Ok(stats) => {
            if stats.ops_posted > 0 {
                log::info!(
                    "sync upload: batches={} posted={} uploaded={} acked={}",
                    stats.batches,
                    stats.ops_posted,
                    stats.blobs_uploaded,
                    stats.blobs_acked
                );
                did_work = true;
            }
        }
        Err(e) => {
            log::warn!("sync upload tick failed: {e}");
            wire_failure = Some(retry_after_from_upload_error(&e));
            let msg = e.to_string();
            if let Ok(conn) = db.lock() {
                let _ = config::mark_sync_error(&conn, &msg);
            }
            wire_error_message = Some(msg);
        }
    }

    // Re-load config because the upload pass may have stamped a
    // user_seq; the pull cursor lives in sync_state.last_seen_user_seq
    // and we want pull to honour any concurrent UI writes too.
    let cfg = {
        let conn = match db.lock() {
            Ok(c) => c,
            Err(e) => {
                log::warn!("sync tick: post-upload config reload mutex: {e}");
                return match wire_failure {
                    Some(ra) => TickOutcome::WireFailure {
                        retry_after: ra,
                        error_message: wire_error_message,
                    },
                    None => TickOutcome::Ok { did_work, ops_received },
                };
            }
        };
        match config::load(&conn) {
            Ok(c) => c,
            Err(e) => {
                log::warn!("sync tick: post-upload config reload failed: {e}");
                return match wire_failure {
                    Some(ra) => TickOutcome::WireFailure {
                        retry_after: ra,
                        error_message: wire_error_message,
                    },
                    None => TickOutcome::Ok { did_work, ops_received },
                };
            }
        }
    };

    match pull::run_pass(db, &cfg, user_keys, device_keys) {
        Ok(stats) => {
            sweep_on_first_pull_transition(&FIRST_PULL_DONE, db, engine);
            if stats.ops_fetched > 0 {
                log::info!(
                    "sync pull: batches={} fetched={} received={} dup_skip={} decrypt_skip={}",
                    stats.batches,
                    stats.ops_fetched,
                    stats.ops_received,
                    stats.ops_skipped_duplicate,
                    stats.ops_skipped_decrypt_error
                );
                did_work = true;
                // Add (not assign): replay above may already have counted
                // recovered merges this tick, and both should fire on_pull.
                ops_received += stats.ops_received;
            }
            // Only mark ok if BOTH passes succeeded.
            if wire_failure.is_none() {
                if let Ok(conn) = db.lock() {
                    let _ = config::mark_sync_ok(&conn, now_ms);
                }
            }
        }
        Err(e) => {
            log::warn!("sync pull tick failed: {e}");
            // Pull's retry_after wins over upload's — the relay's most
            // recent hint represents its current pacing wishes.
            wire_failure = Some(retry_after_from_pull_error(&e));
            let msg = e.to_string();
            if let Ok(conn) = db.lock() {
                let _ = config::mark_sync_error(&conn, &msg);
            }
            wire_error_message = Some(msg);
        }
    }

    // Object fetch: attachments a peer referenced — a reference op the
    // pull pass above may have just merged, or one from an earlier tick —
    // whose bytes haven't landed on this device yet. Task 6 originally put
    // this sweep only in attachments::backfill::run_background (once at
    // startup), mirroring the one-time image backfill's cadence. That's
    // the wrong precedent for an ongoing multi-device sync path: a desktop
    // app left open for days would never fetch anything a peer referenced
    // after launch. It belongs here, on the worker's normal tick cadence,
    // to get retry/backoff/resume for free instead of reimplementing them
    // at the toggle (see Task 4's plan rationale). The startup sweep stays
    // too — it's still right for a cold start with a backlog.
    //
    // `pending_object_fetch` is a plain DB read (no network). Only when it
    // finds something pending do we resolve app_dir + call the network —
    // a quiet tick does zero HTTP calls and never sets `did_work`, so it
    // can't itself perturb the worker's backoff schedule.
    match crate::attachments::backfill::pending_object_fetch(db) {
        Ok(pending) if !pending.is_empty() => {
            if let (Some(base_url), Some(user_id), Some(app_dir)) = (
                cfg.relay_url.clone(),
                cfg.user_id.clone(),
                app_data_dir_from_db(db),
            ) {
                match crate::attachments::backfill::run_object_fetch_at(
                    db,
                    &app_dir,
                    &base_url,
                    &user_id,
                    device_keys,
                    user_keys,
                ) {
                    Ok(0) => {}
                    Ok(n) => {
                        log::info!("sync tick: fetched {n} referenced attachment(s)");
                        did_work = true;
                    }
                    // Best-effort, same as the kex/recovery-key backfills
                    // above: a failure here is per-attachment retryable
                    // (object_fetch_with already leaves failed rows
                    // pending) and must not feed the wire-failure/backoff
                    // path meant for upload/pull outages.
                    Err(e) => log::warn!("sync tick: object fetch failed: {e}"),
                }
            }
        }
        Ok(_) => {}
        Err(e) => log::warn!("sync tick: pending_object_fetch check failed: {e}"),
    }

    // A quiet tick is the only moment the local tables equal the cursor
    // exactly, which is what a snapshot claims. publish() gates itself on
    // the interval and on pending uploads, so calling it every quiet tick
    // costs one SELECT. Never lets a snapshot failure fail the tick itself
    // — it's a best-effort background chore, not part of what the caller's
    // backoff schedule should react to.
    //
    // `&& wire_failure.is_none()`: a quiet tick during a relay outage would
    // otherwise still make a doomed PUT/POST — publish has nothing useful
    // to do until the relay is back.
    if !did_work && wire_failure.is_none() {
        // Re-load config fresh rather than reuse the `cfg` loaded before
        // `pull::run_pass` above: bootstrap (called from inside run_pass)
        // commits sync_state.last_seen_user_seq to the snapshot's own seq
        // in its own transaction and then continues pulling from there. On
        // a device's first quiet tick after bootstrapping, the pre-pull
        // `cfg` still carries the pre-bootstrap cursor (0), so publishing
        // with it would tag the snapshot `user_seq: 0` instead of the real
        // bootstrapped cursor — exactly the "replay everything" bug this
        // branch exists to fix.
        let publish_cfg = {
            let conn = db.lock();
            match conn {
                Ok(conn) => config::load(&conn),
                Err(e) => {
                    log::warn!("sync tick: pre-publish config reload mutex: {e}");
                    return match wire_failure {
                        Some(ra) => TickOutcome::WireFailure {
                            retry_after: ra,
                            error_message: wire_error_message,
                        },
                        None => TickOutcome::Ok { did_work, ops_received },
                    };
                }
            }
        };
        match publish_cfg {
            Ok(fresh_cfg) => {
                match crate::sync::snapshot::publish(db, &fresh_cfg, user_keys, device_keys) {
                    Ok(true) => log::info!("sync tick: snapshot published"),
                    Ok(false) => {}
                    Err(e) => log::warn!("sync tick: snapshot publish failed: {e}"),
                }
            }
            Err(e) => log::warn!("sync tick: pre-publish config reload failed: {e}"),
        }
    }

    match wire_failure {
        Some(ra) => TickOutcome::WireFailure {
            retry_after: ra,
            error_message: wire_error_message,
        },
        None => TickOutcome::Ok { did_work, ops_received },
    }
}

/// Pluck the Retry-After hint out of an upload-pipeline error if it's
/// a Throttled. Any other error variant returns None so the worker
/// falls back to its exponential schedule.
fn retry_after_from_upload_error(e: &upload::UploadError) -> Option<Duration> {
    if let upload::UploadError::Wire(WireError::Throttled { retry_after }) = e {
        return *retry_after;
    }
    None
}

fn retry_after_from_pull_error(e: &pull::PullError) -> Option<Duration> {
    if let pull::PullError::Wire(WireError::Throttled { retry_after }) = e {
        return *retry_after;
    }
    None
}

/// Resolve app_data_dir from the db connection's own file path. The worker
/// thread has no `AppHandle` — `spawn_if_configured` only ever holds a
/// `Db` — so this is the same trick `merge::merge_attachment_blob` uses:
/// the DB lives at `<app_data>/<dbfile>`, so the parent IS app_data. An
/// in-memory connection (unit tests that don't need real blob I/O) has no
/// path and yields `None`, which the object-fetch call site above treats
/// as "nothing to do" rather than an error.
fn app_data_dir_from_db(db: &Db) -> Option<std::path::PathBuf> {
    let conn = db.lock().ok()?;
    let path = conn.path()?;
    std::path::Path::new(path).parent().map(|p| p.to_path_buf())
}

/// Spawn the worker on a dedicated thread. Returns a handle that
/// future code can hold to drop the worker on app shutdown.
pub struct WorkerHandle {
    stop: Arc<AtomicBool>,
    join: Option<std::thread::JoinHandle<()>>,
    /// Optional SSE listener thread that flips the wake flag on
    /// `event: op` so the polling worker exits its sleep early.
    sse_join: Option<std::thread::JoinHandle<()>>,
    /// Same wake flag the SSE thread pokes; exposed so command
    /// handlers can prod the worker right after they emit a new op,
    /// instead of waiting up to DEFAULT_TICK (30s) for the next poll.
    wake_flag: Arc<AtomicBool>,
    /// Scheduled wake time in unix-ms. When non-zero and `now >=
    /// wake_after_ms`, the worker sleep loop treats it as a wake and
    /// resets it to 0. Used for debounced wakes (save-then-/-command
    /// shouldn't trigger an upload of the pre-command state).
    wake_after_ms: Arc<std::sync::atomic::AtomicI64>,
}

/// Bundle of worker-thread callbacks the spawner can register to
/// observe sync events without polling. Each is optional; the
/// `Default` impl yields a callback-less bundle for tests and for
/// mid-session re-spawns from command handlers that don't carry an
/// app handle.
///
/// All callbacks run on the worker thread — they should be cheap
/// (e.g. an `app.emit("...", ())` shipping a Tauri event) and must
/// not block on the db mutex (the worker may still hold it).
#[derive(Default)]
pub struct WorkerCallbacks {
    /// Fires once per tick that successfully merged at least one
    /// remote op into local tables (`ops_received > 0`).
    pub on_pull: Option<Box<dyn Fn() + Send>>,
    /// Fires after any tick whose outcome is `WireFailure`. Lets the
    /// UI flip to "offline" immediately rather than waiting up to a
    /// poll interval to notice via `sync_status`.
    pub on_error: Option<Box<dyn Fn() + Send>>,
    /// Fires after every non-skipped tick so the UI can refresh its
    /// `sync_status` snapshot. Captures changes to
    /// `enabled` / `configured` / `last_sync_at_ms` that don't have
    /// their own dedicated event.
    pub on_status_changed: Option<Box<dyn Fn() + Send>>,
    /// Fires when the relay returns a quota / storage error. Subset
    /// of `on_error` — the UI can route this to a distinct popover.
    pub on_quota: Option<Box<dyn Fn() + Send>>,
    /// Fires once, from the worker loop, the tick a wire failure's
    /// error message classifies as `is_device_revoked_err`. The loop
    /// breaks immediately after — every further call would just 401 —
    /// so this is guaranteed to fire at most once per worker lifetime.
    /// Distinct from `on_error`/`on_quota`: the UI routes this to a
    /// re-pairing prompt, not a transient-failure popover.
    pub on_revoked: Option<Box<dyn Fn() + Send>>,
}

impl WorkerHandle {
    /// Signal the worker to exit and wait for the thread to join.
    /// Idempotent — multiple calls are safe.
    pub fn shutdown(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(h) = self.sse_join.take() {
            let _ = h.join();
        }
        if let Some(h) = self.join.take() {
            let _ = h.join();
        }
    }

    /// Nudge the worker to run a tick now instead of waiting for the
    /// next scheduled poll. Called after the UI emits a new op so the
    /// upload lands within ~250ms instead of up to 30s. Cheap — flips
    /// an AtomicBool the worker's sleep loop checks every 250ms.
    pub fn wake(&self) {
        self.wake_flag.store(true, Ordering::SeqCst);
    }

    /// Debounced wake: schedule a tick `delay_ms` from now. Subsequent
    /// calls reset the target (last write wins), so a flurry of saves
    /// during slash-command interaction coalesces into one upload after
    /// the user has actually settled. Used by save_page_content; the
    /// SSE listener still uses the immediate `wake()` because received
    /// ops shouldn't be artificially delayed.
    pub fn wake_after(&self, delay_ms: i64) {
        let target = now_unix_ms() + delay_ms.max(0);
        self.wake_after_ms.store(target, Ordering::SeqCst);
    }
}

fn now_unix_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

impl Drop for WorkerHandle {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Start the polling loop. Cheap to call; if the config is inactive
/// the loop wakes up every tick and goes back to sleep.
///
/// Keys are moved into the worker — callers wrap them in Arc if they
/// need a shared copy elsewhere. Currently no other code consumes
/// them, so the worker takes ownership outright.
pub fn spawn(
    db: Db,
    user_keys: UserKeys,
    device_keys: DeviceKeys,
    engine: crate::op_log::OpLog,
    tick_every: Duration,
    cbs: WorkerCallbacks,
) -> WorkerHandle {
    let stop = Arc::new(AtomicBool::new(false));
    let wake_flag = Arc::new(AtomicBool::new(false));
    let wake_after_ms = Arc::new(std::sync::atomic::AtomicI64::new(0));

    // Spawn SSE listener if config is active (it needs relay_url + user_id).
    // SSE inactive on first-launch / pre-enrollment → polling only.
    let sse_join = maybe_spawn_sse(&db, &device_keys, wake_flag.clone(), stop.clone());

    let stop_for_thread = stop.clone();
    let wake_for_thread = wake_flag.clone();
    let wake_after_for_thread = wake_after_ms.clone();
    let WorkerCallbacks {
        on_pull,
        on_error,
        on_status_changed,
        on_quota,
        on_revoked,
    } = cbs;
    let join = std::thread::spawn(move || {
        let mut backoff = Backoff::new();
        loop {
            if stop_for_thread.load(Ordering::SeqCst) {
                break;
            }
            // Skip the tick if a wire failure put us in cooldown. The
            // outer wait loop still sleeps and watches the wake_flag,
            // so SSE-driven wake-ups still propagate; they just don't
            // bypass the backoff (the relay's pacing wishes win over
            // SSE eagerness when both apply).
            if !backoff.should_skip(Instant::now()) {
                let outcome = tick(&db, &user_keys, &device_keys, &engine);
                let mut fire_status_changed = false;
                match outcome {
                    TickOutcome::Ok { ops_received, .. } => {
                        backoff.record_success();
                        fire_status_changed = true;
                        if ops_received > 0 {
                            if let Some(ref cb) = on_pull {
                                cb();
                            }
                        }
                    }
                    TickOutcome::WireFailure {
                        retry_after,
                        error_message,
                    } => {
                        // Revocation check comes first and short-circuits
                        // everything else: a revoked device's every future
                        // call would just 401 again, so there is no
                        // backoff schedule worth recording and no
                        // on_error/on_quota popover worth showing — only
                        // the UI's re-pairing prompt matters from here.
                        let revoked = error_message
                            .as_deref()
                            .is_some_and(is_device_revoked_err);
                        if revoked {
                            // This device was revoked. Persist the state,
                            // tell the UI, and stop ticking — every
                            // further call would just 401.
                            if let Ok(conn) = db.lock() {
                                let _ = conn.execute(
                                    "INSERT OR REPLACE INTO settings (key, value, applied_hlc_ts) VALUES ('sync_revoked','1',0)",
                                    [],
                                );
                            }
                            if let Some(ref cb) = on_revoked {
                                cb();
                            }
                            break;
                        }
                        backoff.record_failure(Instant::now(), retry_after);
                        fire_status_changed = true;
                        if let Some(ref cb) = on_error {
                            cb();
                        }
                        // Quota errors get their own callback so the UI
                        // can route them to a distinct popover. Match
                        // on substring because the wire-error chain
                        // string-formats the relay's classifier verbatim.
                        if let Some(ref msg) = error_message {
                            if msg.to_lowercase().contains("quota") {
                                if let Some(ref cb) = on_quota {
                                    cb();
                                }
                            }
                        }
                    }
                    TickOutcome::Skipped => {
                        // No penalty — sync was inactive or DB unavailable.
                        // No status emit either; nothing observable changed.
                    }
                }
                if fire_status_changed {
                    if let Some(ref cb) = on_status_changed {
                        cb();
                    }
                }
            }
            // Reset both wake signals — any flip during the upcoming
            // sleep will short-circuit it.
            wake_for_thread.store(false, Ordering::SeqCst);
            wake_after_for_thread.store(0, Ordering::SeqCst);
            // Sleep in short slices so shutdown latency stays bounded.
            // Wake early on SSE notification, a scheduled debounced
            // wake hitting its deadline, or shutdown.
            let slice = Duration::from_millis(250);
            let mut waited = Duration::ZERO;
            while waited < tick_every
                && !stop_for_thread.load(Ordering::SeqCst)
                && !wake_for_thread.load(Ordering::SeqCst)
                && !wake_after_due(&wake_after_for_thread)
            {
                std::thread::sleep(slice);
                waited += slice;
            }
        }
    });
    WorkerHandle {
        stop,
        join: Some(join),
        sse_join,
        wake_flag,
        wake_after_ms,
    }
}

/// Helper for the sleep loop: returns true once the debounced wake
/// deadline (if any) has been reached. Stored as 0 when no wake is
/// scheduled.
fn wake_after_due(slot: &Arc<std::sync::atomic::AtomicI64>) -> bool {
    let target = slot.load(Ordering::SeqCst);
    target > 0 && now_unix_ms() >= target
}

/// Best-effort SSE spawn. Returns None when sync_state isn't far
/// enough along to make a connection (no relay_url or no user_id).
/// The polling worker still runs in either case.
fn maybe_spawn_sse(
    db: &Db,
    device_keys: &DeviceKeys,
    wake_flag: Arc<AtomicBool>,
    shutdown: Arc<AtomicBool>,
) -> Option<std::thread::JoinHandle<()>> {
    let (base_url, user_id) = {
        let conn = match db.lock() {
            Ok(c) => c,
            Err(_) => return None,
        };
        let cfg = match crate::sync::config::load(&conn) {
            Ok(c) => c,
            Err(_) => return None,
        };
        let url = cfg.relay_url?;
        let uid = cfg.user_id?;
        (url, uid)
    };
    let seed = device_keys.device_sign_priv.to_bytes();
    let device_id = device_keys.device_id;
    Some(crate::sync::wire::live::spawn_listener(
        base_url, user_id, seed, device_id, wake_flag, shutdown,
    ))
}

/// Startup helper: inspect `sync_keys` + `sync_state` and spawn the
/// worker only when both keysets are persisted. Returns `Ok(None)`
/// when sync is not yet configured — the typical fresh-install state.
///
/// Errors are returned (not panicked) so app startup keeps going even
/// if the keys table is in a partial / corrupted state; the user can
/// re-run `setup_sync` from the command surface to repair.
///
/// The op-log `engine` is the app's single instance, passed in rather
/// than loaded here: the worker emits `attachment_blob` ops of its own
/// (after an object upload), and a second `OpLogEngine` would carry its
/// own in-memory HLC high-water mark, so two engines writing in the same
/// millisecond could stamp the same `hlc_ts` twice.
pub fn spawn_if_configured(
    db: Db,
    engine: crate::op_log::OpLog,
    tick_every: Duration,
    cbs: WorkerCallbacks,
) -> Result<Option<WorkerHandle>, String> {
    let (user_keys, device_keys) = {
        let conn = db.lock().map_err(|e| format!("db mutex poisoned: {e}"))?;
        let uk = crate::sync::keys::load_user_keys(&conn)?;
        let dk = crate::sync::keys::load_device_keys(&conn)?;
        (uk, dk)
    };
    let (Some(user_keys), Some(device_keys)) = (user_keys, device_keys) else {
        log::info!("sync: keys not configured — worker not spawned");
        return Ok(None);
    };
    log::info!(
        "sync: spawning worker (device_id={}, tick={:?})",
        device_keys.device_id,
        tick_every
    );
    Ok(Some(spawn(
        db,
        user_keys,
        device_keys,
        engine,
        tick_every,
        cbs,
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::keys::{generate_device_keys, generate_seed_phrase, user_keys_from_phrase};
    use crate::test_helpers::{test_db, test_db_at};
    use httpmock::prelude::*;
    use serde_json::json;

    /// tick() is a no-op when sync_state.enabled is false — the
    /// silent-engine invariant holds even when the worker is spawned.
    #[test]
    fn tick_short_circuits_when_inactive() {
        let db = test_db();
        let m = generate_seed_phrase();
        let uk = user_keys_from_phrase(&m);
        let dk = generate_device_keys();
        // Default test_db has no sync_state row → load() bootstraps a
        // disabled one → tick should do nothing.
        let outcome = tick(&db, &uk, &dk, &engine_for(&db));
        assert!(matches!(outcome, TickOutcome::Skipped));
    }

    // ──────────────────────────────────────────────────────────────
    // Object fetch on the tick cadence (Task 6, fix round 1)
    // ──────────────────────────────────────────────────────────────

    fn active_db_config(db: &Db, base_url: &str) {
        let conn = db.lock().unwrap();
        crate::sync::config::set_relay_url(&conn, base_url).unwrap();
        crate::sync::config::set_enrollment(&conn, "u", "d", 1).unwrap();
        crate::sync::config::set_enabled(&conn, true).unwrap();
    }

    fn insert_attachment(
        db: &Db,
        hash: &str,
        sync: bool,
        has_local: bool,
        object_key: Option<&str>,
    ) {
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO attachments (blob_hash, filename, mime_type, size_bytes, sync, has_local, created_at, last_seen_at, object_key) \
             VALUES (?1, 'f.bin', 'application/octet-stream', 0, ?2, ?3, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', ?4)",
            rusqlite::params![hash, sync as i64, has_local as i64, object_key],
        )
        .unwrap();
    }

    /// The app's op-log engine. Real one, not a stand-in — the worker
    /// emits `attachment_blob` ops through it after an object upload.
    fn engine_for(db: &Db) -> crate::op_log::OpLog {
        let conn = db.lock().unwrap();
        std::sync::Arc::new(crate::op_log::OpLogEngine::load(&conn).unwrap())
    }

    /// Empty-ops mock so `pull::run_pass` succeeds without any real
    /// history to replay — isolates the object-fetch assertions from
    /// pull's own behaviour. Every active tick calls this once per
    /// pull-loop iteration; `has_more: false` means exactly once.
    fn mock_empty_pull(server: &MockServer) {
        server.mock(|when, then| {
            when.method(GET).path("/v1/users/u/ops");
            then.status(200).json_body(json!({ "ops": [], "has_more": false }));
        });
    }

    /// A file-backed db, not `test_db()`'s in-memory one — object fetch
    /// needs `conn.path()` to resolve a real app_data_dir to write the
    /// blob into (same requirement `merge_attachment_blob` has for its
    /// own on-disk write).
    fn file_backed_db() -> (tempfile::TempDir, Db) {
        let dir = tempfile::tempdir().unwrap();
        let db = test_db_at(&dir.path().join("test.db"));
        (dir, db)
    }

    /// A tick with a referenced-but-not-fetched attachment fetches it,
    /// decrypts it, verifies it, writes it, and marks it local — on the
    /// worker's normal cadence, not just at next app launch.
    ///
    /// The object is served at its OBJECT KEY carrying CIPHERTEXT, which
    /// is what a real relay holds: it never sees the plaintext, so the
    /// sha256 the row is keyed by is not an address it could serve from.
    #[test]
    fn tick_fetches_a_pending_referenced_attachment() {
        let server = MockServer::start();
        let (_dir, db) = file_backed_db();
        active_db_config(&db, &server.base_url());
        mock_empty_pull(&server);

        let m = generate_seed_phrase();
        let uk = user_keys_from_phrase(&m);
        let dk = generate_device_keys();

        let bytes = b"attachment plaintext, fetched on tick".to_vec();
        let hash = crate::attachments::store::hash_hex(&bytes);
        let ciphertext = crate::sync::envelope::encrypt_op(
            &uk.content_master_key,
            &uuid::Uuid::new_v4(),
            &bytes,
        );
        let object_key = crate::sync::envelope::blob_hash_hex(&ciphertext);
        insert_attachment(&db, &hash, true, false, Some(&object_key));

        let fetch_mock = server.mock(|when, then| {
            when.method(GET)
                .path(format!("/v1/users/u/attachments/{object_key}"));
            then.status(200).body(ciphertext.clone());
        });

        let outcome = tick(&db, &uk, &dk, &engine_for(&db));

        fetch_mock.assert();
        assert!(
            matches!(outcome, TickOutcome::Ok { did_work: true, .. }),
            "got {outcome:?}"
        );

        let conn = db.lock().unwrap();
        let (has_local, size_bytes): (i64, i64) = conn
            .query_row(
                "SELECT has_local, size_bytes FROM attachments WHERE blob_hash = ?1",
                rusqlite::params![&hash],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(has_local, 1);
        assert_eq!(size_bytes, bytes.len() as i64);
    }

    /// THE MISSING HALF. A tick with an authorised attachment whose
    /// object was never uploaded seals the bytes, PUTs them, and only
    /// THEN emits the reference op — which the same tick's upload pass
    /// then carries to the relay.
    ///
    /// Before this, `put_attachment` had zero callers: the toggle emitted
    /// a reference op and nothing ever uploaded the object it pointed at.
    /// The ordering assertion (`put` happened, and the op exists after)
    /// is the whole point — an op emitted first is a pointer to nothing.
    #[test]
    fn tick_uploads_the_object_before_emitting_its_reference() {
        let server = MockServer::start();
        let (dir, db) = file_backed_db();
        active_db_config(&db, &server.base_url());
        mock_empty_pull(&server);

        let bytes = b"the bytes that never reached the relay".to_vec();
        let hash = crate::attachments::store::hash_hex(&bytes);
        // app_data_dir is the db file's parent (what the worker resolves).
        crate::attachments::store::write_blob(dir.path(), &hash, &bytes).unwrap();
        insert_attachment(&db, &hash, true, true, None);

        let put_mock = server.mock(|when, then| {
            when.method(PUT).path_contains("/v1/users/u/attachments/");
            then.status(200)
                .json_body(json!({ "stored_bytes": bytes.len() }));
        });
        // The op the sweep emits is uploaded by the same tick's upload
        // pass; these keep that pass from failing the tick.
        server.mock(|when, then| {
            when.method(POST).path("/v1/users/u/ops");
            then.status(200)
                .json_body(json!({ "need_upload": [], "ack": [] }));
        });

        let m = generate_seed_phrase();
        let uk = user_keys_from_phrase(&m);
        let dk = generate_device_keys();
        let outcome = tick(&db, &uk, &dk, &engine_for(&db));

        put_mock.assert();
        assert!(
            matches!(outcome, TickOutcome::Ok { did_work: true, .. }),
            "got {outcome:?}"
        );

        let conn = db.lock().unwrap();
        let object_key: Option<String> = conn
            .query_row(
                "SELECT object_key FROM attachments WHERE blob_hash = ?1",
                rusqlite::params![&hash],
                |r| r.get(0),
            )
            .unwrap();
        let object_key = object_key.expect("the row records where the object landed");
        let payload: Vec<u8> = conn
            .query_row(
                "SELECT payload_blob FROM op_log WHERE op_kind = 'attachment_blob' AND doc_id = ?1",
                rusqlite::params![&hash],
                |r| r.get(0),
            )
            .expect("the reference op exists — and only because the PUT succeeded first");
        let parsed: crate::sync::wire::attachment_blob::AttachmentBlobPayload =
            serde_json::from_slice(&payload).unwrap();
        assert_eq!(
            parsed.object_key.as_deref(),
            Some(object_key.as_str()),
            "the op must point at the object that was actually uploaded"
        );
        assert_eq!(parsed.blob_hash, hash);
        assert!(parsed.chunks_b64.is_empty(), "the bytes are in the object");
    }

    /// A failed PUT leaves the attachment exactly as it was: no object
    /// key, and — the part that matters — NO reference op. A peer that
    /// pulled one would fetch forever against an object that isn't there.
    #[test]
    fn a_failed_object_upload_emits_no_reference_op() {
        let server = MockServer::start();
        let (dir, db) = file_backed_db();
        active_db_config(&db, &server.base_url());
        mock_empty_pull(&server);
        server.mock(|when, then| {
            when.method(POST).path("/v1/users/u/ops");
            then.status(200)
                .json_body(json!({ "need_upload": [], "ack": [] }));
        });

        let bytes = b"these bytes do not make it".to_vec();
        let hash = crate::attachments::store::hash_hex(&bytes);
        crate::attachments::store::write_blob(dir.path(), &hash, &bytes).unwrap();
        insert_attachment(&db, &hash, true, true, None);

        // The relay refuses the object (quota, in this case).
        server.mock(|when, then| {
            when.method(PUT).path_contains("/attachments/");
            then.status(429).json_body(json!({
                "error": { "code": "quota_exceeded", "message": "cap reached" }
            }));
        });

        let m = generate_seed_phrase();
        let uk = user_keys_from_phrase(&m);
        let dk = generate_device_keys();
        let _ = tick(&db, &uk, &dk, &engine_for(&db));

        let conn = db.lock().unwrap();
        let object_key: Option<String> = conn
            .query_row(
                "SELECT object_key FROM attachments WHERE blob_hash = ?1",
                rusqlite::params![&hash],
                |r| r.get(0),
            )
            .unwrap();
        assert!(object_key.is_none(), "nothing landed, so nothing is recorded");
        let ops: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM op_log WHERE op_kind = 'attachment_blob'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            ops, 0,
            "a reference op without its object is worse than no op: the peer waits forever"
        );
    }

    /// A tick with nothing pending does no attachment-object network I/O
    /// at all — neither sweep — and doesn't report did_work on their
    /// account: a sweep that always "did something" would defeat the
    /// worker's backoff.
    #[test]
    fn tick_with_nothing_pending_does_no_object_io() {
        let server = MockServer::start();
        let (_dir, db) = file_backed_db();
        active_db_config(&db, &server.base_url());
        mock_empty_pull(&server);
        // has_local already true AND an object key already recorded:
        // nothing for either the fetch sweep or the upload sweep to do.
        insert_attachment(&db, "already-local", true, true, Some("already-up"));

        // If the tick made ANY attachments-object call, one of these
        // matches — the real assertion is `assert_hits(0)` below, not
        // either mock's status.
        let fetch_mock = server.mock(|when, then| {
            when.method(GET).path_contains("/attachments/");
            then.status(200).body(Vec::<u8>::new());
        });
        let put_mock = server.mock(|when, then| {
            when.method(PUT).path_contains("/attachments/");
            then.status(200).json_body(json!({ "stored_bytes": 0 }));
        });

        let m = generate_seed_phrase();
        let uk = user_keys_from_phrase(&m);
        let dk = generate_device_keys();
        let outcome = tick(&db, &uk, &dk, &engine_for(&db));

        fetch_mock.assert_hits(0);
        put_mock.assert_hits(0);
        // did_work reflects only what actually happened; with an empty
        // pull and nothing to fetch, this tick moved nothing.
        assert!(
            matches!(outcome, TickOutcome::Ok { did_work: false, .. }),
            "got {outcome:?}"
        );
    }

    // ──────────────────────────────────────────────────────────────
    // Orphan sweep on the first-pull transition (fix round: no race)
    // ──────────────────────────────────────────────────────────────
    //
    // These test `sweep_on_first_pull_transition` directly against a
    // private `AtomicBool`, NOT `tick()` against the process-global
    // `FIRST_PULL_DONE`. An earlier version of this test drove it through
    // `tick()` with a mocked relay, resetting the global flag and then
    // asserting on its post-tick value — and it was genuinely flaky under
    // `cargo test`'s parallel execution: the mocked HTTP round trip inside
    // `tick()` opens a wall-clock window during which a concurrently
    // running test's own successful `tick()` can flip the SAME global
    // flag first, so this test's own transition either double-fires or
    // never fires from its point of view. A scoped `AtomicBool` removes
    // that window while still exercising the exact same logic `tick()`
    // calls in production.

    /// The mount-time orphan sweeper (`cleanup_orphan_pages_inner`)
    /// refuses to run while sync is enabled and the first-pull flag is
    /// still false — sweeping before the first pull risks tombstoning a
    /// page whose content ops from another device haven't merged yet.
    /// Before this fix, nothing ever retried the sweep once the first
    /// pull *did* land later in the session: the frontend's one mount-time
    /// call had already run (and skipped), so a launch that raced the
    /// first pull left orphan pages unswept for the rest of the session.
    #[test]
    fn sweep_on_first_pull_transition_sweeps_on_false_to_true() {
        let flag = std::sync::atomic::AtomicBool::new(false);
        let db = test_db();
        // An orphan candidate: untrailed, no focus, no lines, no content —
        // exactly what insert_page seeds and cleanup_orphan_pages_inner's
        // SQL filter targets.
        let orphan_id = {
            let conn = db.lock().unwrap();
            crate::test_helpers::insert_page(&conn, "2026-08-14", 1)
        };

        sweep_on_first_pull_transition(&flag, &db, &engine_for(&db));

        assert!(flag.load(Ordering::SeqCst), "the flag must end up true");
        let conn = db.lock().unwrap();
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pages WHERE id = ?1",
                rusqlite::params![&orphan_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            n, 0,
            "the orphan sweep must run on the false→true transition"
        );
    }

    /// Calling the helper when the flag is ALREADY true (no transition —
    /// this isn't the first successful pull of the session) must not
    /// sweep. Pins the trigger to the transition specifically, not "any
    /// call".
    #[test]
    fn sweep_on_first_pull_transition_is_a_no_op_when_already_true() {
        let flag = std::sync::atomic::AtomicBool::new(true);
        let db = test_db();
        let orphan_id = {
            let conn = db.lock().unwrap();
            crate::test_helpers::insert_page(&conn, "2026-08-14", 1)
        };

        sweep_on_first_pull_transition(&flag, &db, &engine_for(&db));

        assert!(flag.load(Ordering::SeqCst), "stays true");
        let conn = db.lock().unwrap();
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pages WHERE id = ?1",
                rusqlite::params![&orphan_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 1, "no transition, no sweep");
    }

    /// Wiring check: a real tick with a successful (empty) pull flips the
    /// process-global `FIRST_PULL_DONE` — proving `tick()` actually calls
    /// through to the transition helper, without asserting on ordering
    /// against other concurrently-running tests (see the section note
    /// above for why that assertion belongs on the helper, not here).
    #[test]
    fn tick_with_successful_pull_flips_first_pull_done() {
        let server = MockServer::start();
        let db = test_db();
        active_db_config(&db, &server.base_url());
        mock_empty_pull(&server);

        let m = generate_seed_phrase();
        let uk = user_keys_from_phrase(&m);
        let dk = generate_device_keys();
        let outcome = tick(&db, &uk, &dk, &engine_for(&db));

        assert!(matches!(outcome, TickOutcome::Ok { .. }), "got {outcome:?}");
        assert!(
            FIRST_PULL_DONE.load(Ordering::SeqCst),
            "a successful pull must leave the flag true, whoever set it"
        );
    }

    // ──────────────────────────────────────────────────────────────
    // Backoff — phase 14.23
    // ──────────────────────────────────────────────────────────────

    #[test]
    fn backoff_starts_with_no_penalty() {
        let b = Backoff::new();
        assert!(!b.should_skip(Instant::now()));
        assert_eq!(b.current, MIN_BACKOFF);
    }

    #[test]
    fn record_failure_without_retry_after_doubles_exponentially() {
        let mut b = Backoff::new();
        let now = Instant::now();
        b.record_failure(now, None);
        // 1s → 2s
        assert_eq!(b.current, Duration::from_secs(2));
        b.record_failure(now, None);
        // 2s → 4s
        assert_eq!(b.current, Duration::from_secs(4));
        // Several more doublings to verify the ceiling holds.
        for _ in 0..20 {
            b.record_failure(now, None);
        }
        assert_eq!(b.current, MAX_BACKOFF);
    }

    #[test]
    fn record_failure_with_retry_after_honours_the_hint() {
        let mut b = Backoff::new();
        let now = Instant::now();
        b.record_failure(now, Some(Duration::from_secs(60)));
        // The schedule's `current` doesn't advance on Retry-After —
        // the relay's pacing hint replaces our exponential default.
        // (Some implementations advance both; we don't, so a relay
        // that emits a quick Retry-After doesn't poison our schedule.)
        assert_eq!(b.current, MIN_BACKOFF);
        // But we ARE in cooldown until ~60s from now.
        assert!(b.should_skip(now));
        assert!(b.should_skip(now + Duration::from_secs(30)));
        assert!(!b.should_skip(now + Duration::from_secs(61)));
    }

    #[test]
    fn record_failure_clamps_retry_after_at_max_backoff() {
        let mut b = Backoff::new();
        let now = Instant::now();
        // Relay claims a 1-hour hint — we cap at MAX_BACKOFF so a
        // misbehaving relay can't park the worker for an hour.
        b.record_failure(now, Some(Duration::from_secs(3600)));
        assert!(!b.should_skip(now + MAX_BACKOFF + Duration::from_secs(1)));
    }

    #[test]
    fn record_success_clears_penalty_and_resets_schedule() {
        let mut b = Backoff::new();
        let now = Instant::now();
        b.record_failure(now, None);
        b.record_failure(now, None);
        assert_eq!(b.current, Duration::from_secs(4));
        b.record_success();
        assert_eq!(b.current, MIN_BACKOFF);
        assert!(!b.should_skip(now));
    }

    #[test]
    fn should_skip_is_false_while_inside_no_penalty_window() {
        let mut b = Backoff::new();
        let t0 = Instant::now();
        // Penalty for ~2s.
        b.record_failure(t0, None);
        // Still within the window.
        assert!(b.should_skip(t0 + Duration::from_millis(500)));
        // Past the window.
        assert!(!b.should_skip(t0 + Duration::from_secs(3)));
    }

    /// Fresh DB: spawn_if_configured returns None and does NOT start
    /// a thread. This is the silent default — the engine is dormant
    /// until setup_sync writes keys.
    #[test]
    fn spawn_if_configured_returns_none_when_keys_missing() {
        let db = test_db();
        let handle =
            spawn_if_configured(db.clone(), engine_for(&db), Duration::from_secs(30), WorkerCallbacks::default())
                .unwrap();
        assert!(handle.is_none());
    }

    /// Keys persisted but sync_state inactive: the worker DOES spawn
    /// (so it's ready to react if the user flips `enabled`), but
    /// tick() will short-circuit until the config goes active.
    #[test]
    fn spawn_if_configured_spawns_when_keys_present_even_if_inactive() {
        let db = test_db();
        {
            let conn = db.lock().unwrap();
            let m = generate_seed_phrase();
            crate::sync::keys::persist_user_phrase(&conn, &m).unwrap();
            let dk = generate_device_keys();
            crate::sync::keys::persist_device_keys(&conn, &dk).unwrap();
        }
        let mut handle =
            spawn_if_configured(
                db.clone(),
                engine_for(&db),
                Duration::from_millis(250),
                WorkerCallbacks::default(),
            )
            .unwrap();
        assert!(handle.is_some(), "worker spawned despite inactive config");
        // Immediate shutdown is fine — sleep slices are 250ms so the
        // worker will exit promptly.
        handle.as_mut().unwrap().shutdown();
    }

    // ──────────────────────────────────────────────────────────────
    // Revoked-device detection
    // ──────────────────────────────────────────────────────────────

    #[test]
    fn revoked_classifier_matches_relay_error_strings() {
        assert!(is_device_revoked_err("wire: 401 device_revoked"));
        assert!(is_device_revoked_err(r#"closed {"reason":"device_revoked"}"#));
        assert!(!is_device_revoked_err("wire: 500 internal"));
        assert!(!is_device_revoked_err("network unreachable"));
    }

    /// A tick whose pull fails with a `device_revoked` wire error must:
    /// persist the `sync_revoked` settings flag, fire `on_revoked`, and
    /// stop the worker loop for good — not just back off and retry. The
    /// mock relay keeps answering 401 device_revoked forever, so if the
    /// loop kept ticking it would hammer that endpoint repeatedly; the
    /// hit-count assertion after a multi-tick-interval wait is what
    /// proves it stopped rather than merely slowed down.
    #[test]
    fn worker_stops_and_persists_flag_on_device_revoked() {
        let server = MockServer::start();
        let db = test_db();
        active_db_config(&db, &server.base_url());

        let ops_mock = server.mock(|when, then| {
            when.method(GET).path("/v1/users/u/ops");
            then.status(401).json_body(json!({
                "error": { "code": "device_revoked", "message": "this device was revoked" }
            }));
        });

        let m = generate_seed_phrase();
        let uk = user_keys_from_phrase(&m);
        let dk = generate_device_keys();

        let revoked_fired = std::sync::Arc::new(AtomicBool::new(false));
        let revoked_fired_cb = revoked_fired.clone();
        let cbs = WorkerCallbacks {
            on_revoked: Some(Box::new(move || {
                revoked_fired_cb.store(true, Ordering::SeqCst);
            })),
            ..Default::default()
        };

        let mut handle = spawn(
            db.clone(),
            uk,
            dk,
            engine_for(&db),
            Duration::from_millis(30),
            cbs,
        );

        // Poll for on_revoked to fire, budget generously above a handful
        // of tick intervals.
        let deadline = Instant::now() + Duration::from_secs(3);
        while !revoked_fired.load(Ordering::SeqCst) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(revoked_fired.load(Ordering::SeqCst), "on_revoked never fired");

        // Give the loop several more would-be tick intervals to prove it
        // actually stopped rather than merely slowed its backoff.
        std::thread::sleep(Duration::from_millis(300));
        handle.shutdown();

        ops_mock.assert_hits(1);

        let conn = db.lock().unwrap();
        let v = crate::sync::config::get_setting_i64(&conn, "sync_revoked");
        assert_eq!(v, Some(1), "revocation must persist the sync_revoked flag");
    }

    // ──────────────────────────────────────────────────────────────
    // Whole-branch review, Finding 1: the quiet-tick publish() call must
    // not use the `cfg` loaded before `pull::run_pass` — bootstrap moves
    // the cursor from inside that call, so the pre-pull `cfg` is stale for
    // exactly the tick that matters most: a device's first quiet tick
    // after snapshot bootstrap.
    // ──────────────────────────────────────────────────────────────

    /// A fresh device bootstraps from the newest remote snapshot (seq 40),
    /// the continuation pull fetches nothing new, and the tick is quiet —
    /// so it reaches the snapshot-publish hook. That publish must tag the
    /// snapshot with the bootstrapped cursor (40), not the cursor `cfg`
    /// held before pull ran (0). Before the fix, `tick` reused the
    /// pre-pull `cfg`, so `snapshot::publish` captured the (correctly
    /// bootstrapped) tables but recorded `snapshot_last_seq = "0"` and
    /// shipped a stream-3 snapshot claiming `user_seq: 0` — a later
    /// bootstrapping device would take it and replay the whole account.
    #[test]
    fn first_quiet_tick_after_bootstrap_publishes_the_bootstrapped_cursor_not_zero() {
        let server = MockServer::start();
        let db = test_db();
        active_db_config(&db, &server.base_url());
        let m = generate_seed_phrase();
        let uk = user_keys_from_phrase(&m);
        let dk = generate_device_keys();

        // Build a real snapshot blob from a seeded source db, sealed under
        // epoch 0 — the same recipe pull.rs's bootstrap test uses.
        let src = test_db();
        let (ct, hash) = {
            let c = src.lock().unwrap();
            c.execute("INSERT INTO pages (id, date, page_number, what_matters_now, created_at, updated_at) VALUES ('from-snap','2026-08-22',1,'kept','0','0')", []).unwrap();
            let snap = crate::sync::snapshot::capture(&c, 40).unwrap();
            let bytes = crate::sync::snapshot::encode(&snap).unwrap();
            let ck = crate::sync::epoch::content_master_key_for_epoch(&c, &uk, 0).unwrap().unwrap();
            let sp = crate::sync::epoch::user_sign_priv_for_epoch(&c, &uk, 0).unwrap().unwrap();
            let ct = crate::sync::op_auth::seal_authored(&ck, &uuid::Uuid::new_v4(), &bytes, &dk, &sp);
            let hash = crate::sync::envelope::blob_hash_hex(&ct);
            (ct, hash)
        };

        // Bootstrap probe: one real sealed snapshot at user_seq 40.
        server.mock(|when, then| {
            when.method(GET).path("/v1/users/u/ops").query_param("stream", "3");
            then.status(200).json_body(json!({"ops": [
                {"user_seq": 40, "blob_hash": hash, "blob_size": ct.len(), "doc_id_ct": "", "op_kind": "snapshot", "stream_id": 3, "device_id": "x", "created_at": 0, "epoch": 0}
            ], "has_more": false}));
        });
        server.mock(|when, then| {
            when.method(GET).path(format!("/v1/users/u/blobs/{hash}"));
            then.status(200).body(ct.clone());
        });
        // Continuation pull from the bootstrapped cursor fetches nothing new
        // — the exact condition that leaves `did_work == false` this tick.
        server.mock(|when, then| {
            when.method(GET).path("/v1/users/u/ops").query_param("since", "40");
            then.status(200).json_body(json!({"ops": [], "has_more": false}));
        });
        // The quiet-tick publish: blob PUT then op POST.
        server.mock(|when, then| {
            when.method(PUT).path_matches(Regex::new(r"^/v1/users/u/blobs/[0-9a-f]{64}$").unwrap());
            then.status(200).json_body(json!({"user_seq": 999}));
        });
        let post = server.mock(|when, then| {
            when.method(POST).path("/v1/users/u/ops");
            then.status(200).json_body(json!({"need_upload": [], "ack": []}));
        });

        let outcome = tick(&db, &uk, &dk, &engine_for(&db));
        assert!(
            matches!(outcome, TickOutcome::Ok { did_work: false, .. }),
            "got {outcome:?}; the bootstrap + empty continuation pull must leave this tick quiet"
        );

        // Capturing the PUT body via httpmock's request recording is
        // awkward here, so assert the local side effect the same publish
        // code path writes instead: `settings.snapshot_last_seq`, which
        // `snapshot::publish` records as `cursor.to_string()`. With the
        // stale pre-pull cfg that cursor reads "0" — that's the red this
        // test catches.
        assert_eq!(post.hits(), 1, "the quiet tick must actually publish a snapshot");
        let conn = db.lock().unwrap();
        let recorded: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key='snapshot_last_seq'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            recorded, "40",
            "publish must tag the bootstrapped cursor (40), not the stale pre-pull cfg (0)"
        );
    }
}
