use std::sync::atomic::{AtomicBool, Ordering};

// Linux + flatpak note: Tauri's tray-icon plugin writes the PNG bytes
// passed to `.icon()` into `$XDG_RUNTIME_DIR/tray-icon/` and broadcasts
// that absolute path as the StatusNotifierItem `IconName` property.
// In flatpak, each app has a private xdg-run, so gnome-shell / kded
// (outside the sandbox) can't read that path -- the tray falls back
// to a generic icon. The flatpak manifests in `flatpak/` and
// `flahub/flathub-fork/` work around this with `--filesystem=
// xdg-run/tray-icon:create`, which bind-mounts the host's
// $XDG_RUNTIME_DIR/tray-icon at the same name inside the sandbox.
// Tauri upstream fix would be: broadcast an icon-theme name (e.g.
// "app.shizumu.Shizumu", already exported via hicolor) instead of an
// absolute path. Track at tauri-apps/tray-icon.
//
// That workaround is what flathub reports as "can read and write all
// data in the directory", and with --share=network it is why the app
// lists as Medium Risk. Reviewed 2026-08-21 and kept: dropping it costs
// the icon and does not change the rating, since network alone holds it
// there. See the comment on that finish-arg in the manifest.
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, Theme, WindowEvent,
};

#[cfg(target_os = "linux")]
const TRAY_DARK: &[u8] = include_bytes!("../icons/tray/dark/64x64.png");
#[cfg(target_os = "linux")]
const TRAY_LIGHT: &[u8] = include_bytes!("../icons/tray/light/64x64.png");
#[cfg(not(target_os = "linux"))]
const TRAY_DARK: &[u8] = include_bytes!("../icons/tray/dark/32x32.png");
#[cfg(not(target_os = "linux"))]
const TRAY_LIGHT: &[u8] = include_bytes!("../icons/tray/light/32x32.png");
const TRAY_ID: &str = "main";

pub struct CloseToTray(pub AtomicBool);

fn icon_for_theme(theme: Option<Theme>) -> Image<'static> {
    if cfg!(target_os = "macos") {
        return Image::from_bytes(TRAY_DARK).expect("failed to load tray icon");
    }
    let bytes = match theme {
        Some(Theme::Dark) => TRAY_LIGHT,
        _ => TRAY_DARK,
    };
    Image::from_bytes(bytes).expect("failed to load tray icon")
}

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let open = MenuItem::with_id(app, "open", "open shizumu", true, None::<&str>)?;
    let new_page = MenuItem::with_id(app, "new_page", "new page", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "quit", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&open, &new_page, &separator, &quit])?;

    let initial_theme = app
        .get_webview_window("main")
        .and_then(|w| w.theme().ok());

    #[cfg_attr(not(target_os = "macos"), allow(unused_variables))]
    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon_for_theme(initial_theme))
        .tooltip("shizumu")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => {
                show_main_window(app);
            }
            "new_page" => {
                show_main_window(app);
                let app_handle = app.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(300));
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.eval("window.__shizumu_new_page?.()");
                    }
                });
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click { .. } = event {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    #[cfg(target_os = "macos")]
    {
        let _ = tray.set_icon_as_template(true);
    }

    if let Some(window) = app.get_webview_window("main") {
        let app_handle = app.clone();
        window.on_window_event(move |event| {
            match event {
                WindowEvent::ThemeChanged(theme) => {
                    if let Some(tray) = app_handle.tray_by_id(TRAY_ID) {
                        let _ = tray.set_icon(Some(icon_for_theme(Some(*theme))));
                    }
                }
                WindowEvent::CloseRequested { api, .. } => {
                    let enabled = app_handle
                        .try_state::<CloseToTray>()
                        .map(|s| s.0.load(Ordering::Relaxed))
                        .unwrap_or(false);
                    if enabled {
                        api.prevent_close();
                        if let Some(w) = app_handle.get_webview_window("main") {
                            let _ = w.hide();
                        }
                    }
                }
                _ => {}
            }
        });
    }

    Ok(())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
