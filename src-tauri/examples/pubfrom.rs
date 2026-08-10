use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use ed25519_dalek::SigningKey;

fn main() {
    let hex = std::env::args().nth(1).expect("pass hex of sign_priv");
    let bytes = hex::decode(&hex).expect("valid hex");
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&bytes);
    let sk = SigningKey::from_bytes(&arr);
    let pub_b64 = B64.encode(sk.verifying_key().to_bytes());
    println!("{pub_b64}");
}
