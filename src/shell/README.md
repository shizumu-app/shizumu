# src/shell — the mobile shell

The phone and touch-tablet UI. Desktop keeps `src/components/`, visually
untouched; the fork is `isMobileNav()` (viewport + pointer), never the OS.

**This tree owns all chrome and borrows all logic.** Screens and primitives
live here. Data, the editor core, the TipTap extensions, and every pure
decision module are imported from `src/lib/` and `src/components/editor/`
unchanged — see the allowlists in `__tests__/shell-rules.test.js`.

**The rules test is not advisory.** `__tests__/shell-rules.test.js` runs on
every `npx vitest run` and fails the build on raw `<button>`, `env(safe-area`,
`visualViewport`, `@media (max-width`, stray `position: fixed`, and imports
outside the allowlists. Each rule is a bug class that reached a device; the
header comment in that file names them.

**Decisions live in `src/shell/*.js`, never inside a component.** If a
component contains an `if` that decides *what the UI is* rather than *how to
draw it*, it belongs in a module here with a test. The eight the design
requires: `platform`, `nav-collapse`, `sheet-detent`, `stack-back`,
`gesture-owner`, `toolbar-model`, `drop-target`, `caret-visible`.

Spec: `docs/superpowers/specs/2026-08-22-mobile-shell-design.md`.
