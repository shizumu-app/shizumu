// No shipped target may keep the sync identity in process memory.
//
// secret_store.rs picks its backend by cfg. The in-process one is for unit
// tests; until 2026-10-24 its cfg also matched iOS, where a store passed
// the round-trip check in keys::persist_user_*, the database copy was
// cleared, and the next launch found neither: a paired iPhone forgot its
// enrolment on every restart. iOS cannot be built or run on the dev box,
// so this reads the cfg lines as text, the way window_after_state_tests.rs
// reads setup's order.

const SRC: &str = include_str!("../src/sync/secret_store.rs");

/// The `#[cfg(...)]` line directly above each `mod backend {`.
fn backend_cfgs() -> Vec<String> {
    let lines: Vec<&str> = SRC.lines().collect();
    lines
        .iter()
        .enumerate()
        .filter(|(_, l)| l.trim() == "mod backend {")
        .map(|(i, _)| lines[i - 1].trim().to_string())
        .collect()
}

#[test]
fn the_in_process_backend_is_for_tests_only() {
    let in_process = SRC
        .find("static SLOT: Mutex<Option<String>>")
        .expect("the in-process backend still exists");
    let module = SRC[..in_process].rfind("mod backend {").expect("SLOT lives in a backend module");
    let cfg = SRC[..module].lines().last().unwrap_or_default().trim();
    assert_eq!(
        cfg, "#[cfg(test)]",
        "the in-process backend forgets the sync identity at exit; no shipped target may select it"
    );
}

#[test]
fn ios_and_android_use_the_file_backend() {
    let cfgs = backend_cfgs();
    assert!(
        cfgs.iter().any(|c| c.contains("target_os = \"android\"")
            && c.contains("target_os = \"ios\"")
            && c.contains("not(test)")),
        "no backend covers both phones outside tests: {cfgs:?}"
    );
}

// 0.8.2 turns real keyring backends on for the database key. The desktop
// sync backend used to call keyring::Entry, harmlessly, because the crate
// had no backend and kept nothing; with a real backend the round-trip in
// keys::persist_user_* would start passing and DELETE the sync_keys rows,
// leaving a keyring the only copy of the sync identity. Until the move in
// docs/superpowers/specs/2026-11-02-desktop-keyring-design.md lands, the
// desktop backend must not reach the keyring crate.
#[test]
fn the_desktop_sync_backend_does_not_reach_the_keyring_yet() {
    let cfg = "#[cfg(all(desktop, not(test)))]\nmod backend {";
    let start = SRC.find(cfg).expect("a desktop backend exists");
    let body_end = start + SRC[start..].find("\n}\n").expect("module ends");
    let body = &SRC[start..body_end];
    let code: String = body
        .lines()
        .filter(|l| !l.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n");
    assert!(
        !code.contains("keyring::"),
        "the desktop sync backend reaches the keyring crate: the sync_keys rows would be deleted"
    );
}
