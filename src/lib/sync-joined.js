// src/lib/sync-joined.js
// A DEVICE THAT JOINED AN ACCOUNT LOOKS AT ITS PAGE AGAIN, AT ONCE.
//
// Joining (pairing, phrase recovery, re-claiming a relay that has history)
// can delete the blank page the app made at launch, so the first pull can
// start from the account's newest snapshot (snapshot.rs
// `clear_placeholder_pages`). The page the writer has open is then gone,
// and every save to it fails. The sync-pulled listener already re-adopts
// today's page when the open one has vanished; this event asks for the
// same thing as soon as the join lands, rather than waiting for a pull.
// A brand-new account (sync_init) deletes nothing and does not announce.
export const SYNC_JOINED = "shizumu:sync-joined";

export function announceJoined() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(SYNC_JOINED));
}
