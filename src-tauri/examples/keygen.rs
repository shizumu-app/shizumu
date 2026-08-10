use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use shizumu_lib::sync::keys;

fn main() {
    let phrase = keys::generate_seed_phrase();
    let user_keys = keys::user_keys_from_phrase(&phrase);
    let pub_b64 = B64.encode(user_keys.user_sign_pub_bytes());
    println!("phrase:  {phrase}");
    println!("pub_b64: {pub_b64}");
}
