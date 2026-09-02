// Which backend the app talks to, and in what order of precedence.
//
// This was three inline branches in api.js's call(). It moved out when the
// browser demo added a fourth possibility: precedence here decides whether a
// VR capture is deterministic and whether a demo bundle could ever reach a
// real database, and neither question should be answered by reading an
// if-chain inside a 1,500-line file.
//
// `invoke` is null for the kinds api.js has to construct for itself: the
// Tauri import is dynamic, and the mock is built on demand.

/**
 * @param {{vrInvoke?: Function|null, demoInvoke?: Function|null, isTauri?: boolean}} env
 * @returns {{kind: "vr"|"demo"|"tauri"|"mock", invoke: Function|null}}
 */
export function resolveInvokeSource({ vrInvoke = null, demoInvoke = null, isTauri = false } = {}) {
  if (vrInvoke) return { kind: "vr", invoke: vrInvoke };
  if (demoInvoke) return { kind: "demo", invoke: demoInvoke };
  if (isTauri) return { kind: "tauri", invoke: null };
  return { kind: "mock", invoke: null };
}
