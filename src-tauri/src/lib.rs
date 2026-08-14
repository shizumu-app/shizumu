pub mod attachments;
pub mod commands;
#[allow(dead_code)]
mod crypto;
pub mod db;
pub mod test_helpers;
#[cfg(target_os = "linux")]
mod dbus;
pub mod export;
pub mod trail_export;
#[cfg(target_os = "linux")]
mod gnome_search;
#[cfg(target_os = "linux")]
mod krunner;
#[cfg(target_os = "linux")]
mod managed_config;
mod models;
#[allow(dead_code)]
pub mod op_log;
pub mod sync;
#[cfg(desktop)]
mod tray;

use tauri::{image::Image, Emitter, Manager};
#[cfg(desktop)]
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            // Enable logs in both debug and release for v0.2.2 — diagnosing a
            // "works-in-dev-not-in-rpm" keyboard-plugin bug. The release-build
            // logging cost is small; revisit narrowing this once the issue is
            // pinned.
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;

            // Auto-open devtools so the user can inspect the production webview.
            // Same v0.2.2 diagnostic — gated behind the SHIZUMU_DEVTOOLS env var
            // so it doesn't pop on every launch for normal users.
            if std::env::var_os("SHIZUMU_DEVTOOLS").is_some() {
                if let Some(webview) = app.get_webview_window("main") {
                    webview.open_devtools();
                }
            }

            // Set window icon (Linux needs this for taskbar/WM icon).
            // set_icon is desktop-only — mobile platforms own the icon
            // via the launcher manifest, so the rust call doesn't exist
            // on android / ios builds.
            #[cfg(desktop)]
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(icon) = Image::from_bytes(include_bytes!("../icons/icon.png")) {
                    let _ = window.set_icon(icon);
                }
            }

            // Manage close-to-tray state before tray setup so the
            // CloseRequested handler can read it immediately.
            #[cfg(desktop)]
            app.manage(tray::CloseToTray(
                std::sync::atomic::AtomicBool::new(false),
            ));

            // Linux/webkit2gtk: auto-grant every webview permission
            // request so getUserMedia (QR scanner camera) works without
            // an engine-level prompt that webkit2gtk doesn't always
            // surface cleanly under wry. The user already opted in to
            // scanning when they opened the pair flow; a second prompt
            // from the engine layer that can't be styled or routed to
            // the OS chrome is worse than no prompt at all.
            #[cfg(target_os = "linux")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.with_webview(|webview| {
                        use webkit2gtk::{PermissionRequestExt, WebViewExt};
                        let wv: webkit2gtk::WebView = webview.inner();
                        wv.connect_permission_request(|_, request| {
                            request.allow();
                            true
                        });
                    });
                }
            }

            // Set up system tray — desktop only. Mobile platforms (iOS,
            // Android) don't have a tray; the module isn't compiled
            // there. Phase 11.8 gate.
            #[cfg(desktop)]
            if let Err(e) = tray::setup_tray(app.handle()) {
                log::warn!("failed to set up system tray: {e}");
            }

            // Register default global shortcut: Super+Shift+W to toggle window.
            // Desktop-only — iOS and Android don't expose a global-shortcut
            // surface (the OS owns the keymap), and the plugin isn't
            // available on those targets either.
            #[cfg(desktop)]
            {
                let shortcut =
                    Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyW);
                if let Err(e) = app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_shortcut(shortcut)?
                        .with_handler(move |app, _shortcut, event| {
                            if event.state
                                == tauri_plugin_global_shortcut::ShortcutState::Pressed
                            {
                                if let Some(window) = app.get_webview_window("main") {
                                    if window.is_visible().unwrap_or(false) {
                                        let _ = window.hide();
                                    } else {
                                        let _ = window.show();
                                        let _ = window.unminimize();
                                        let _ = window.set_focus();
                                    }
                                }
                            }
                        })
                        .build(),
                ) {
                    log::warn!("failed to register global shortcut: {e}");
                }
            }

            let app_data_dir = app
                .handle()
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");

            // Android has no keyring provider the `keyring` crate supports,
            // so the sync-secrets bundle is stored as a mode-0600 JSON file
            // in the app's per-package private data dir. The secret_store
            // backend is zero-arg and can't resolve that sandbox path itself,
            // so capture it here before any sync command can run. See
            // docs/v0.4-sync-mobile.md.
            #[cfg(target_os = "android")]
            match app.handle().path().app_local_data_dir() {
                Ok(dir) => sync::secret_store::init_android_secrets_dir(dir),
                Err(e) => {
                    log::error!("failed to resolve app_local_data_dir for sync secrets: {e}")
                }
            }

            // One-shot rename: v0.1.22 used bundle id `com.shizumu.app`; v0.1.23 switched
            // to `app.shizumu.Shizumu` (Flathub requires reverse-DNS of the actual domain
            // shizumu.app, and disallows generic last components like "app"). On first
            // launch after upgrade, move the old data dir into the new one so existing
            // users don't lose their writing.
            if !app_data_dir.exists() {
                if let Some(parent) = app_data_dir.parent() {
                    let legacy = parent.join("com.shizumu.app");
                    if legacy.exists() {
                        match std::fs::rename(&legacy, &app_data_dir) {
                            Ok(_) => log::info!(
                                "migrated data dir: {} -> {}",
                                legacy.display(),
                                app_data_dir.display()
                            ),
                            Err(e) => log::warn!(
                                "data dir migration failed ({} -> {}): {e}",
                                legacy.display(),
                                app_data_dir.display()
                            ),
                        }
                    }
                }
            }

            // Try to retrieve passphrase from system keyring
            let passphrase = crypto::retrieve_key();

            // Initialize database synchronously (rusqlite is sync — no deadlock risk)
            let database = db::init_db(app_data_dir, passphrase.as_deref())
                .expect("failed to initialize database");

            // Phase 13: silent op-log engine. Loaded after the DB is up
            // so it can read the persisted hlc_state row. Failure here
            // would mean the schema is wrong — let it panic; the
            // migration test catches this in CI.
            let op_log_engine: op_log::OpLog = {
                let conn = database.lock().expect("db mutex poisoned");
                let engine = op_log::OpLogEngine::load(&conn)
                    .expect("failed to load op-log engine");
                std::sync::Arc::new(engine)
            };

            // Bake-week baseline: log the op-log shape at startup so a
            // tail of the app log shows engine state without needing
            // the frontend or audit binary. Logged BEFORE backfill
            // spawns so the line reflects the pre-backfill state.
            match op_log::stats::collect(&database.lock().expect("db mutex poisoned")) {
                Ok(s) => log::info!("{}", op_log::stats::format_log_line(&s)),
                Err(e) => log::warn!("op_log stats collect failed: {e}"),
            }

            // Eager backfill: one-shot replay of existing v0.2.x data
            // into op_log so the relay (v0.4) sees a complete history
            // even for users who upgrade and don't write anything.
            // Runs on a background thread with 10ms sleeps between
            // batches so the UI mutex stays available — per the
            // phase 13 plan's "no splash screen" constraint and Risk
            // #2 mitigation. The backfill_cursor + backfill_complete
            // keys in op_log_meta make it resumable across launches.
            op_log::backfill::run_background(database.clone(), op_log_engine.clone());

            // Image backfill (phase 2 of the attachment unification): pages
            // written before images moved onto the blob store still hold
            // `localImage` nodes, which have no blob_hash and so no per-image
            // sync toggle. Converts them in the background — registering at
            // sync: false, never deleting the originals, and leaving any page
            // whose file it can't read for the next launch.
            attachments::backfill::run_background(
                app.handle().clone(),
                database.clone(),
                op_log_engine.clone(),
            );

            let op_log_engine_for_worker = op_log_engine.clone();
            app.manage::<op_log::OpLog>(op_log_engine);

            // Phase 14: sync engine worker. The slot is always managed
            // (so `sync_setup` from the command surface can spawn the
            // worker mid-session after writing keys) — but the slot
            // holds `None` on a fresh install. WorkerHandle::Drop
            // signals shutdown + joins, so app exit cleans up the
            // thread automatically.
            // Worker-event hookup. The polling worker fires four
            // callbacks: on_pull (after ops_received > 0),
            // on_error (after a wire failure), on_status_changed
            // (after every non-skipped tick so the UI can re-poll
            // sync_status without waiting on the 30s frontend timer),
            // and on_quota (subset of on_error). Each one emits a
            // Tauri event the SyncStatusPill subscribes to so it can
            // reflect a wire failure in < 1s instead of < 30s.
            let handle = app.handle().clone();
            let cbs = sync::worker::WorkerCallbacks {
                on_pull: Some({
                    let h = handle.clone();
                    Box::new(move || {
                        let _ = h.emit("sync-pulled", ());
                    })
                }),
                on_error: Some({
                    let h = handle.clone();
                    Box::new(move || {
                        let _ = h.emit("sync-error", ());
                    })
                }),
                on_status_changed: Some({
                    let h = handle.clone();
                    Box::new(move || {
                        let _ = h.emit("sync-status-changed", ());
                    })
                }),
                on_quota: Some({
                    let h = handle.clone();
                    Box::new(move || {
                        let _ = h.emit("sync-quota", ());
                    })
                }),
                on_revoked: Some({
                    let h = handle.clone();
                    Box::new(move || {
                        let _ = h.emit("sync-revoked", ());
                    })
                }),
            };
            let worker_slot: commands::SyncWorkerSlot = std::sync::Arc::new(
                match sync::worker::spawn_if_configured(
                    database.clone(),
                    op_log_engine_for_worker,
                    sync::worker::DEFAULT_TICK,
                    cbs,
                ) {
                    Ok(slot) => std::sync::Mutex::new(slot),
                    Err(e) => {
                        log::warn!("sync worker spawn failed: {e}");
                        std::sync::Mutex::new(None)
                    }
                },
            );
            app.manage::<commands::SyncWorkerSlot>(worker_slot);

            // Pairing sessions: in-memory map of pair_token →
            // ephemeral X25519 secret. Populated by `pair_new_join`
            // on the new device, consumed by `pair_new_complete`.
            // Dropped on app shutdown — pairing is intentionally
            // ephemeral; restarting cancels any in-flight pairings.
            app.manage::<commands::PairingSessions>(std::sync::Arc::new(
                std::sync::Mutex::new(std::collections::HashMap::new()),
            ));

            // Linux-only: managed deployment config + DBus service
            #[cfg(target_os = "linux")]
            {
                let managed_config = managed_config::ManagedConfig::load();
                managed_config.apply(&database);

                let dbus_handle = app.handle().clone();
                let dbus_db = database.clone();
                std::thread::spawn(move || {
                    let rt = tokio::runtime::Runtime::new().unwrap();
                    rt.block_on(async {
                        if let Err(e) = dbus::start_dbus_service(dbus_handle, dbus_db).await {
                            log::warn!("dbus service failed: {e}");
                        }
                    });
                });
            }

            app.manage(database);

            // Hydrate close-to-tray from persisted setting.
            #[cfg(desktop)]
            {
                use rusqlite::OptionalExtension;
                use std::sync::atomic::Ordering;
                let db = app.state::<db::Db>();
                let conn = db.lock().expect("db mutex poisoned");
                let val: Option<String> = conn
                    .query_row(
                        "SELECT value FROM settings WHERE key = 'close_to_tray'",
                        [],
                        |row| row.get(0),
                    )
                    .optional()
                    .unwrap_or(None);
                if val.as_deref() == Some("true") {
                    app.state::<tray::CloseToTray>()
                        .0
                        .store(true, Ordering::Relaxed);
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_or_create_today,
            commands::get_page,
            commands::save_line,
            commands::create_new_page,
            commands::clone_page_for_new_day,
            commands::cleanup_empty_day_markers,
            commands::cleanup_orphan_pages,
            commands::update_what_matters_now,
            commands::update_what_shifted,
            commands::get_adjacent_page,
            commands::get_page_count_for_date,
            commands::strike_line,
            commands::check_onboarding_complete,
            commands::mark_onboarding_complete,
            commands::get_thread,
            commands::search_pages,
            commands::get_ground_data,
            commands::get_setting,
            commands::set_setting,
            commands::set_close_to_tray,
            commands::delete_all_data,
            commands::get_open_focuses,
            commands::update_line_text,
            commands::check_and_add_session_marker,
            commands::get_focuses_for_date,
            commands::get_focus_picker_list,
            commands::set_focus_parent,
            commands::get_focus_lineage,
            commands::create_block,
            commands::add_block_item,
            commands::update_block_item_state,
            commands::get_blocks_for_page,
            commands::promote_block_to_shared,
            commands::get_inherited_shared_blocks,
            commands::delete_focus,
            commands::get_lineages,
            commands::create_lineage,
            commands::set_focus_lineage,
            commands::get_canonical_trail_page,
            commands::append_page_to_canonical,
            commands::delete_lineage,
            commands::rename_lineage,
            commands::set_lineage_parent,
            commands::fold_lineage,
            commands::search_pages_for_mention,
            commands::get_page_for_mention,
            commands::get_backlinks_for_page,
            commands::get_backlinks_for_pin,
            commands::get_lineage_path,
            commands::get_trail_pages,
            commands::get_trail_page_counts,
            commands::insert_line_at,
            commands::delete_line,
            commands::update_block_item_text,
            commands::reorder_lines,
            commands::save_page_content,
            commands::load_page_content_for_modal,
            commands::save_page_content_with_pin_refresh,
            commands::save_trail_content,
            commands::get_pins,
            commands::create_pin,
            commands::update_pin_status,
            commands::update_pin_content,
            commands::update_pin_scope,
            commands::delete_pin,
            commands::update_pin_auto_insert,
            commands::reorder_pins,
            commands::resolve_pin_divergence,
            commands::get_pin_for_reference,
            commands::search_pins_for_mention,
            commands::get_carry_forward_pins,
            commands::save_shukonin_session,
            commands::get_shukonin_sessions_for_date,
            commands::check_encryption_status,
            commands::setup_encryption,
            commands::unlock,
            commands::lock,
            commands::get_lock_timeout,
            commands::set_lock_timeout,
            commands::export_pages_gui,
            commands::backup_database_gui,
            commands::save_image_file,
            commands::save_image_bytes,
            commands::op_log_stats,
            commands::sync_replay_failed,
            trail_export::export_trail_folder_list_data,
            trail_export::export_trail_folder_prepare,
            trail_export::export_trail_folder_write,
            trail_export::export_trail_folder_copy_image,
            commands::sync_generate_phrase,
            commands::sync_reveal_phrase,
            commands::sync_setup,
            commands::sync_enroll,
            commands::sync_self_enroll,
            commands::sync_init,
            commands::sync_set_enabled,
            commands::sync_force_reupload,
            commands::sync_status,
            commands::sync_flush_now,
            commands::sync_error_history,
            commands::sync_pause,
            commands::sync_resume,
            commands::sync_force_pull,
            commands::sync_set_relay_url,
            commands::sync_revoke_device,
            commands::sync_list_devices,
            commands::sync_quota,
            commands::sync_set_account_email,
            commands::sync_account_email_status,
            commands::sync_redeem_license,
            commands::sync_relay_health,
            commands::sync_reset,
            commands::sync_switch_relay,
            commands::pair_existing_start,
            commands::pair_existing_fetch_sas,
            commands::pair_existing_confirm,
            commands::pair_new_join,
            commands::pair_new_complete,
            attachments::commands::attachment_add,
            attachments::commands::attachment_add_bytes,
            attachments::commands::attachment_open,
            attachments::commands::attachment_set_sync,
            attachments::commands::attachment_list,
            attachments::commands::attachment_gc,
            attachments::commands::attachment_local_bytes,
            attachments::commands::attachment_local_src,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
