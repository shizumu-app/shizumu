// Deterministic time + ids for the VR harness. VR-only; never imported by
// production code paths (bootstrap is dev/VITE_VR gated).
const RealDate = Date;
const realUuid = typeof crypto !== "undefined" ? crypto.randomUUID : undefined;
let installed = false;

export function installFixedClock(iso) {
  const fixed = RealDate.parse(iso);
  class FixedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(fixed);
      else super(...args);
    }
    static now() {
      return fixed;
    }
  }
  // eslint-disable-next-line no-global-assign
  globalThis.Date = FixedDate;
  installed = true;
}

export function installSeqUuid(prefix = "vr") {
  let n = 0;
  const gen = () => {
    n += 1;
    return `${prefix}-${String(n).padStart(16, "0")}`;
  };
  if (typeof crypto === "undefined") {
    // eslint-disable-next-line no-global-assign
    globalThis.crypto = {};
  }
  crypto.randomUUID = gen;
  installed = true;
}

export function resetVrDeterminism() {
  if (!installed) return;
  // eslint-disable-next-line no-global-assign
  globalThis.Date = RealDate;
  if (realUuid) crypto.randomUUID = realUuid;
  installed = false;
}
