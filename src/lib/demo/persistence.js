// Storing the browser demo's workspace between visits.
//
// Every function here treats storage as failable. localStorage is not a
// dictionary that is sometimes empty: in a private window, with site data
// blocked, or inside a thumbnail capture, the accessor itself throws. A demo
// that throws while somebody is typing in it has failed at the one job the
// surrounding copy promises.

export const DEMO_STORAGE_KEY = "shizumu.demo.v1";

export function serialize(seedVersion, data) {
  return JSON.stringify({ seedVersion, data });
}

export function parse(raw) {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return { seedVersion: parsed.seedVersion, data: parsed.data };
  } catch {
    return null;
  }
}

export function shouldRestore(payload, seedVersion) {
  if (!payload || !payload.data) return false;
  return payload.seedVersion === seedVersion;
}

export function readStored(storage, seedVersion) {
  if (!storage) return null;
  let raw;
  try {
    raw = storage.getItem(DEMO_STORAGE_KEY);
  } catch {
    return null;
  }
  const payload = parse(raw);
  return shouldRestore(payload, seedVersion) ? payload.data : null;
}

/** @returns {boolean} false means the caller runs in memory for this session. */
export function writeStored(storage, seedVersion, data) {
  if (!storage) return false;
  try {
    storage.setItem(DEMO_STORAGE_KEY, serialize(seedVersion, data));
    return true;
  } catch {
    return false;
  }
}

export function clearStored(storage) {
  if (!storage) return;
  try {
    storage.removeItem(DEMO_STORAGE_KEY);
  } catch {
    // Nothing to do: the next read fails closed and the demo reseeds.
  }
}
