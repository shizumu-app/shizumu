use std::path::Path;
use std::{env, fs, process};

fn main() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let openssl_dir = manifest_dir.join("openssl");

    if openssl_dir.exists() {
        return;
    }

    let pkg_version = env!("CARGO_PKG_VERSION");
    let openssl_version = pkg_version.split('+').nth(1).unwrap_or(pkg_version);
    let out_dir_str = env::var("OUT_DIR").unwrap();
    let out_dir = Path::new(&out_dir_str);
    let tarball = out_dir.join(format!("openssl-{openssl_version}.tar.gz"));

    let url = format!(
        "https://github.com/openssl/openssl/releases/download/openssl-{openssl_version}/openssl-{openssl_version}.tar.gz"
    );

    eprintln!("openssl-src: downloading OpenSSL {openssl_version}...");

    let status = process::Command::new("curl")
        .args(["-fL", "-o", &tarball.to_string_lossy(), &url])
        .status()
        .expect("failed to run curl; is curl installed?");
    assert!(status.success(), "failed to download OpenSSL from {url}");

    eprintln!("openssl-src: extracting...");
    let status = process::Command::new("tar")
        .args([
            "-xzf",
            &tarball.to_string_lossy(),
            "-C",
            &out_dir.to_string_lossy(),
        ])
        .status()
        .expect("failed to run tar; is tar installed?");
    assert!(status.success(), "failed to extract OpenSSL tarball");

    let extracted = out_dir.join(format!("openssl-{openssl_version}"));
    fs::rename(&extracted, &openssl_dir).expect("failed to rename openssl directory");

    eprintln!("openssl-src: OpenSSL {openssl_version} ready");
}
