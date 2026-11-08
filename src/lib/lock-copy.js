// What both lock screens say to a refused passphrase.
//
// The account has one lock (src-tauri/src/account_lock.rs): a device that
// was shut while the passphrase changed on another one is still keyed with
// the passphrase before it, until it opens and syncs. Without this line a
// writer who just changed it on the laptop meets a phone that refuses the
// new one and nothing says why.
export const WRONG_PASSPHRASE =
  "wrong passphrase. if it was changed on another device, the one before it still opens this one until it syncs.";
