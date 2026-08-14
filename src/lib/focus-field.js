// focus-field.js — the one way to programmatically focus a text field.
//
// Mobile webviews only raise the soft keyboard for focus that traces to a
// user gesture; and a focus effect that re-fires (state change → effect →
// focus → viewport resize → state change …) blurs and re-focuses in a
// loop the user experiences as "the keyboard flashes and disappears".
// One rAF focus per open-cycle, guarded here, ends that class.
const focusedThisCycle = new WeakSet();

export function focusField(el, { select = false } = {}) {
  if (!el || focusedThisCycle.has(el)) return;
  focusedThisCycle.add(el);
  requestAnimationFrame(() => {
    try {
      el.focus();
      if (select) el.select?.();
    } catch {}
  });
}
focusField.reset = (el) => { if (el) focusedThisCycle.delete(el); };

/** Dev-only: log every focus/blur with target + stack so the blur thief
 * is identifiable on-device (call from main.js behind import.meta.env.DEV). */
export function installFocusTrace(win = window) {
  const log = (kind) => (e) => {
    // eslint-disable-next-line no-console
    console.warn(`[focus-trace] ${kind}`, e.target?.tagName, e.target?.className, new Error("at").stack?.split("\n")[2]?.trim());
  };
  win.addEventListener("focusin", log("focusin"), true);
  win.addEventListener("focusout", log("focusout"), true);
}
