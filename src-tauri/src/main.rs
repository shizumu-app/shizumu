// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  // Work around WebKitGTK EGL crash on some GPU drivers (NVIDIA, AppImage)
  #[cfg(target_os = "linux")]
  if std::env::var("WEBKIT_DISABLE_COMPOSITING_MODE").is_err() {
    std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
  }

  shizumu_lib::run();
}
