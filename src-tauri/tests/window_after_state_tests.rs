// The window must not exist before the state its page's commands need.
//
// Tauri builds every config window whose `create` is true BEFORE it calls the
// app's setup hook, so a page loaded from such a window can send a command
// while setup is still opening the database, and that command fails with
// "state not managed for field `db`". On the A16 (2026-10-24) the rejected
// read was App.svelte's `try_new_shell`, and the phone booted the desktop
// tree for the whole session. These read the two files as text: the order
// of lines in setup is the property, and nothing at runtime can observe it
// without a webview.

const CONF: &str = include_str!("../tauri.conf.json");
const LIB: &str = include_str!("../src/lib.rs");

#[test]
fn the_config_window_is_not_built_by_tauri() {
    let conf: serde_json::Value = serde_json::from_str(CONF).expect("tauri.conf.json parses");
    let windows = conf["app"]["windows"].as_array().expect("app.windows is a list");
    assert!(!windows.is_empty(), "the main window is still described in the config");
    for w in windows {
        assert_eq!(
            w["create"],
            serde_json::Value::Bool(false),
            "a config window Tauri builds itself loads before setup has managed the database"
        );
    }
}

#[test]
fn setup_builds_the_window_after_every_managed_state() {
    let build = LIB
        .find("WebviewWindowBuilder::from_config")
        .expect("setup builds the window from the config");
    let last_manage = LIB.rfind("app.manage").expect("setup manages state");
    assert!(
        build > last_manage,
        "the window is built before the last app.manage, so its page can call a command whose state does not exist yet"
    );
    // The tray hangs close-to-tray on the window, so it must come after it.
    let tray = LIB.find("tray::setup_tray(").expect("setup sets up the tray");
    assert!(tray > build, "the tray looks the window up during setup; built after it, it finds none");
}
