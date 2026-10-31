fn main() {
  // Android 15 devices can run with 16 KB memory pages, and Play refuses an
  // update whose native libraries were linked for 4 KB ones. 0.8.0 shipped
  // with every libshizumu_lib.so at 0x1000. The flag lives here rather than in
  // .cargo/config.toml because the tauri cli sets its own per-target
  // RUSTFLAGS for android, and a link arg from the build script holds whatever
  // the environment says. scripts/check-android-16k.py fails the CI build if
  // the packaged libraries lose it.
  if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
    println!("cargo:rustc-link-arg=-Wl,-z,max-page-size=16384");
  }
  tauri_build::build()
}
