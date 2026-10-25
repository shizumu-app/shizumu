// The three roots of the shell, spelled once.
//
// There were two spellings before this file: the gallery's catalogue row
// and TabBar's own test fixture, with the real host still unwritten. P1c's
// handoff named the next step exactly — "P2's real host will hardcode them
// again" — so the constant lands with ShellApp rather than becoming the
// third copy. A root list that disagrees with itself is not a cosmetic
// drift: `active` is matched against `id`, so a host spelling "settings"
// against a bar spelling "setting" renders a bar with nothing current on
// it, which reads as the tab bar having lost its place.
//
// Frozen because it is module-scoped: one consumer doing ROOTS.push() or
// reordering in place outlives every component instance that mounts after
// it, and the symptom — the tab bar changed on its own, in a screen that
// never touched it — points at the wrong file. Frozen, that same line
// throws at the site that wrote it. The entries are frozen too; freezing
// only the array would leave `ROOTS[0].label = "..."` a silent rename.
//
// TabBar's own test keeps its own fixture on purpose. It covers TabBar
// against an arbitrary tab list, which is what a primitive's unit test is
// for; pointing it here would trade that coverage for a second assertion
// about this app's roots.

export const ROOTS = Object.freeze([
  Object.freeze({ id: "page", label: "page" }),
  Object.freeze({ id: "memory", label: "memory" }),
  Object.freeze({ id: "settings", label: "settings" }),
]);
