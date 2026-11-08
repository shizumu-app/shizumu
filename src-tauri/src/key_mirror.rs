//! The OS keyring as a second copy of the database key, never the first.
//!
//! Until 0.8.2 the `keyring` crate was built with no platform backend, so
//! nothing ever reached a real keyring and the key file (0600, in the
//! profile's data folder) was the only store. 0.8.2 turns the backends on
//! for desktop builds outside Flatpak (macOS Keychain, Windows Credential
//! Manager, Linux Secret Service) and fills the keyring as a MIRROR of the
//! file. The file stays, and the file wins:
//!
//! - a disagreement is resolved for the file, because the file is the copy
//!   every earlier version read and wrote, and the one `change_passphrase`
//!   writes first; a keyring entry that differs is a write that did not
//!   finish, or one from a backend that answered Ok and dropped it (KDE and
//!   some headless Fedora setups did exactly this to the sync secrets);
//! - the keyring is read at launch only when the file is gone, so a locked,
//!   missing or prompting keyring can never stand between the writer and
//!   their pages while the file is there;
//! - launch never mirrors, checks or repairs the copy: the copy is written
//!   (off the command thread) only when the key is deliberately written, so
//!   a locked keyring that asks to be unlocked for any call cannot put its
//!   dialog up at every launch;
//! - with no file, launch reads the keyring at most once, briefly, and a
//!   read that finds nothing, fails or times out is not tried again until
//!   the next deliberate write of the key; an attempt that never finished
//!   (a prompt left unanswered, the app closed) counts the same, so the
//!   keyring never prompts in a loop.
//!
//! Decisions live here as pure functions over [`SecretSlot`], so tests run
//! against an in-memory slot and no test ever reaches a real keyring.
//! `crypto.rs` wires them to the key file and to `keyring::Entry`.
//!
//! See docs/superpowers/specs/2026-11-02-desktop-keyring-design.md.

// Mobile builds compile this module but never mirror (`keyring_allowed`
// is false there), so parts of it are unused on those targets.
#![cfg_attr(not(desktop), allow(dead_code))]

/// One keyring entry. `get` answers `Ok(None)` for "no such entry", and an
/// error for everything else (locked, no service, refused, ambiguous).
pub trait SecretSlot {
    fn get(&self) -> Result<Option<String>, String>;
    fn set(&self, value: &str) -> Result<(), String>;
    fn delete(&self) -> Result<(), String>;
}

/// Whether this build, in this environment, may touch the OS keyring at all.
///
/// Mobile: never (iOS and Android keep their file backends; the iOS keychain
/// outlives an uninstall while the database does not, which needs its own
/// design). Flatpak: never, since Flathub disallows talking to
/// `org.freedesktop.secrets` directly; the file in the sandbox's data dir is
/// the store there, and the sync harness sets FLATPAK_ID for the same reason
/// (so a test profile never writes the writer's keyring).
pub fn keyring_allowed(is_desktop: bool, flatpak_id_set: bool) -> bool {
    is_desktop && !flatpak_id_set
}

/// What is known about the keyring copy, kept in a small non-secret marker
/// file beside the key file. It holds one of these words and nothing else.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MirrorState {
    /// An attempt began and never reported back: most likely a prompt the
    /// writer did not answer, or a keyring that hung.
    Pending,
    /// The keyring held the file's key when last checked.
    InStep,
    /// The keyring refused, failed, or did not keep what was written.
    Unavailable,
}

impl MirrorState {
    pub fn as_str(self) -> &'static str {
        match self {
            MirrorState::Pending => "pending",
            MirrorState::InStep => "in-step",
            MirrorState::Unavailable => "unavailable",
        }
    }

    /// Unknown text reads as `Pending`: the cautious answer, since it stops
    /// launch from reaching for the keyring.
    pub fn parse(s: &str) -> MirrorState {
        match s.trim() {
            "in-step" => MirrorState::InStep,
            "unavailable" => MirrorState::Unavailable,
            _ => MirrorState::Pending,
        }
    }
}

/// What launch makes of the marker it finds. A `Pending` marker at launch is
/// an attempt the last run started and never finished (the app was closed
/// while a prompt was open, or the keyring hung): nothing is waiting on it
/// any more, so it is recorded as what it is, `Unavailable`, until the next
/// deliberate write of the key (turning the lock on, changing the
/// passphrase). Launch itself never starts a mirror: see `resolve_launch_key`.
pub fn settle_at_launch(state: Option<MirrorState>) -> Option<MirrorState> {
    match state {
        Some(MirrorState::Pending) => Some(MirrorState::Unavailable),
        other => other,
    }
}

/// What one mirror pass did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Mirrored {
    /// The keyring already held the file's key. Nothing was written.
    InStep,
    /// The keyring had no entry; it now holds the file's key (read back and
    /// compared). This is the first-run migration.
    Written,
    /// The keyring held a different key; the file won and the keyring now
    /// holds the file's key (read back and compared).
    Rewritten,
    /// The keyring could not be read, refused the write, or did not hold
    /// what was written. The file is untouched either way.
    Unavailable(String),
}

impl Mirrored {
    pub fn state(&self) -> MirrorState {
        match self {
            Mirrored::Unavailable(_) => MirrorState::Unavailable,
            _ => MirrorState::InStep,
        }
    }
}

/// Make the keyring hold `file_key`. Never touches the file: the file is the
/// key's home in 0.8.2 and this only ever copies out of it.
pub fn mirror_into(slot: &dyn SecretSlot, file_key: &str) -> Mirrored {
    let had = match slot.get() {
        Ok(Some(k)) if k == file_key => return Mirrored::InStep,
        Ok(found) => found.is_some(),
        Err(e) => return Mirrored::Unavailable(format!("read: {e}")),
    };
    // The file wins a disagreement: see the module comment. Overwriting the
    // keyring copy loses nothing, because the key it held is either the one
    // the file already has, or one the database no longer opens with.
    if let Err(e) = slot.set(file_key) {
        return Mirrored::Unavailable(format!("write: {e}"));
    }
    match slot.get() {
        Ok(Some(k)) if k == file_key => {
            if had {
                Mirrored::Rewritten
            } else {
                Mirrored::Written
            }
        }
        Ok(Some(_)) => Mirrored::Unavailable("read back a different key".into()),
        Ok(None) => Mirrored::Unavailable("the write did not persist".into()),
        Err(e) => Mirrored::Unavailable(format!("read back: {e}")),
    }
}

/// What launch found: the key to open the database with, and a marker
/// state to record, when the launch learned something.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchKey {
    pub key: Option<String>,
    pub record: Option<MirrorState>,
}

/// Which key launch opens the database with.
///
/// - The file, whenever there is one, and the keyring is not touched at all:
///   not read, not checked, not mirrored. On a locked Secret Service even a
///   read asks to unlock, so any keyring call at launch would put a password
///   dialog in front of every writer whose keyring starts locked, at every
///   launch (review #2). The copy is made when the key is deliberately
///   written instead (`store_key`).
/// - With no file and an encrypted database, the keyring is read once, unless
///   the marker says `Unavailable`. A read that finds nothing, fails or
///   times out records `Unavailable`, so the next launch does not ask again;
///   the lock screen asks for the passphrase instead.
/// - An unencrypted database needs no key, and most writers have one, so
///   their launch never touches the keyring.
///
/// `state` is the marker after `settle_at_launch`.
pub fn resolve_launch_key(
    file_key: Option<String>,
    db_encrypted: bool,
    state: Option<MirrorState>,
    read_keyring: impl FnOnce() -> Option<String>,
) -> LaunchKey {
    let none = LaunchKey { key: None, record: None };
    match file_key {
        Some(k) => LaunchKey { key: Some(k), record: None },
        None if !db_encrypted => none,
        None if state == Some(MirrorState::Unavailable) => none,
        None => match read_keyring() {
            Some(k) => LaunchKey { key: Some(k), record: None },
            None => LaunchKey { key: None, record: Some(MirrorState::Unavailable) },
        },
    }
}

#[cfg(test)]
pub mod memory {
    //! In-memory keyring for tests. Never the system keyring.
    use super::SecretSlot;
    use std::cell::{Cell, RefCell};

    /// One entry, with switches for the failures a real keyring shows.
    #[derive(Default)]
    pub struct MemorySlot {
        pub value: RefCell<Option<String>>,
        /// Every call errors (locked keyring, no Secret Service on D-Bus).
        pub unavailable: Cell<bool>,
        /// `set` answers Ok and keeps nothing (the KDE / headless case).
        pub drops_writes: Cell<bool>,
        pub calls: Cell<usize>,
    }

    impl MemorySlot {
        pub fn holding(v: &str) -> Self {
            let s = MemorySlot::default();
            *s.value.borrow_mut() = Some(v.to_string());
            s
        }
    }

    impl SecretSlot for MemorySlot {
        fn get(&self) -> Result<Option<String>, String> {
            self.calls.set(self.calls.get() + 1);
            if self.unavailable.get() {
                return Err("no secret service".into());
            }
            Ok(self.value.borrow().clone())
        }
        fn set(&self, value: &str) -> Result<(), String> {
            self.calls.set(self.calls.get() + 1);
            if self.unavailable.get() {
                return Err("no secret service".into());
            }
            if !self.drops_writes.get() {
                *self.value.borrow_mut() = Some(value.to_string());
            }
            Ok(())
        }
        fn delete(&self) -> Result<(), String> {
            self.calls.set(self.calls.get() + 1);
            if self.unavailable.get() {
                return Err("no secret service".into());
            }
            *self.value.borrow_mut() = None;
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::memory::MemorySlot;
    use super::*;

    #[test]
    fn first_run_copies_the_file_key_into_an_empty_keyring() {
        let slot = MemorySlot::default();
        assert_eq!(mirror_into(&slot, "k1"), Mirrored::Written);
        assert_eq!(slot.value.borrow().as_deref(), Some("k1"));
        assert_eq!(mirror_into(&slot, "k1"), Mirrored::InStep, "a second pass writes nothing");
    }

    #[test]
    fn when_they_disagree_the_file_wins_and_the_keyring_is_rewritten() {
        let slot = MemorySlot::holding("stale");
        assert_eq!(mirror_into(&slot, "current"), Mirrored::Rewritten);
        assert_eq!(slot.value.borrow().as_deref(), Some("current"));
    }

    #[test]
    fn a_keyring_that_cannot_be_reached_is_reported_not_retried_at_launch() {
        let slot = MemorySlot::default();
        slot.unavailable.set(true);
        let m = mirror_into(&slot, "k1");
        assert!(matches!(m, Mirrored::Unavailable(_)), "{m:?}");
        assert_eq!(m.state(), MirrorState::Unavailable);
    }

    #[test]
    fn a_write_the_keyring_drops_is_not_counted_as_kept() {
        let slot = MemorySlot::default();
        slot.drops_writes.set(true);
        assert!(matches!(mirror_into(&slot, "k1"), Mirrored::Unavailable(_)));
    }

    #[test]
    fn launch_opens_with_the_file_and_never_asks_the_keyring_while_it_exists() {
        for state in [None, Some(MirrorState::InStep), Some(MirrorState::Pending), Some(MirrorState::Unavailable)] {
            let mut asked = false;
            let k = resolve_launch_key(Some("file".into()), true, state, || {
                asked = true;
                Some("keyring".into())
            });
            assert_eq!(k, LaunchKey { key: Some("file".into()), record: None });
            assert!(!asked, "a locked keyring must not stand between the writer and the file ({state:?})");
        }
    }

    #[test]
    fn launch_falls_back_to_the_keyring_only_for_an_encrypted_database_without_a_file() {
        assert_eq!(
            resolve_launch_key(None, true, None, || Some("keyring".into())).key.as_deref(),
            Some("keyring")
        );
        assert_eq!(
            resolve_launch_key(None, true, Some(MirrorState::InStep), || Some("keyring".into())).key.as_deref(),
            Some("keyring")
        );
        let mut asked = false;
        let k = resolve_launch_key(None, false, None, || {
            asked = true;
            Some("keyring".into())
        });
        // An unencrypted database opens without a key; asking the keyring
        // would prompt every writer who never turned the lock on.
        assert_eq!(k, LaunchKey { key: None, record: None });
        assert!(!asked);
    }

    #[test]
    fn a_launch_read_that_finds_nothing_is_not_tried_again_until_the_key_is_written() {
        // Nothing found, an error, or a timeout all come back as None.
        let first = resolve_launch_key(None, true, None, || None);
        assert_eq!(first, LaunchKey { key: None, record: Some(MirrorState::Unavailable) });
        let mut asked = false;
        let next = resolve_launch_key(None, true, first.record, || {
            asked = true;
            Some("keyring".into())
        });
        // The lock screen asks for the passphrase instead; asking the
        // keyring again would put its dialog up at every launch.
        assert_eq!(next, LaunchKey { key: None, record: None });
        assert!(!asked);
    }

    #[test]
    fn an_attempt_the_last_run_never_finished_is_recorded_unavailable_at_launch() {
        assert_eq!(settle_at_launch(Some(MirrorState::Pending)), Some(MirrorState::Unavailable));
        assert_eq!(settle_at_launch(Some(MirrorState::InStep)), Some(MirrorState::InStep));
        assert_eq!(settle_at_launch(Some(MirrorState::Unavailable)), Some(MirrorState::Unavailable));
        assert_eq!(settle_at_launch(None), None);
        assert_eq!(MirrorState::parse("garbage"), MirrorState::Pending);
        for s in [MirrorState::Pending, MirrorState::InStep, MirrorState::Unavailable] {
            assert_eq!(MirrorState::parse(s.as_str()), s);
        }
    }

    #[test]
    fn flatpak_and_mobile_never_reach_the_keyring() {
        assert!(keyring_allowed(true, false));
        assert!(!keyring_allowed(true, true), "flatpak keeps to its file");
        assert!(!keyring_allowed(false, false), "mobile keeps to its file backend");
        assert!(!keyring_allowed(false, true));
    }
}
