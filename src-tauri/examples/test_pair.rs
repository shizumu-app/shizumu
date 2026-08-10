use shizumu_lib::sync::keys;
use shizumu_lib::sync::wire::pair;

fn main() {
    let home = std::env::var("HOME").unwrap();
    let db_path = std::path::PathBuf::from(format!(
        "{home}/.local/share/app.shizumu.Shizumu/settles.db"
    ));
    let conn = rusqlite::Connection::open(&db_path).expect("open db");
    let dk = keys::load_device_keys(&conn).unwrap().expect("device keys");
    let cfg = shizumu_lib::sync::config::load(&conn).unwrap();
    let relay = cfg.relay_url.expect("relay_url");
    let uid = cfg.user_id.expect("user_id");
    println!("relay={relay} user={uid} device={}", dk.device_id);
    match pair::pair_start(&relay, &dk, &uid, 300) {
        Ok(r) => println!("pair_token={} expires_at={}", r.pair_token, r.expires_at),
        Err(e) => println!("ERROR: {e:?}"),
    }
}
