# contributing

Thanks for looking. Read this first — the repository works differently from
most, and knowing how will save you wasted effort.

## This repository is a snapshot, not the development tree

Development happens in a private repository. What you see here is a snapshot
published at each release: one commit per version, force-replacing the tree.

Two consequences:

- **Merge requests opened against this repository cannot be merged.** The next
  release overwrites the tree, and your branch with it. This is not a judgement
  on the patch — the plumbing simply cannot carry it.
- **The commit history is not the development history.** Don't expect `git blame`
  to explain why a line exists.

So: **open an issue, don't open an MR.** For anything beyond a typo, describe
the problem before writing code. If a patch is the clearest way to explain
yourself, paste a diff into the issue, with a `Signed-off-by` line certifying
the [Developer Certificate of Origin](https://developercertificate.org/) —
that you wrote it or otherwise have the right to submit it under this
project's licence. A diff without one won't be applied; ask and one will be
added for you. It will be applied by hand, with credit in the commit message.

Issues: <https://github.com/shizumu-app/shizumu/issues>

This is a genuine limitation, not a preference. If contribution volume ever
justifies it, the model will change.

## Before proposing a feature

shizumu is a private thinking space built on four verbs:

> write to think. pin what matters. trail what continues. the rest sinks.

The product is defined as much by what it refuses as by what it does. These are
**permanent refusals** — proposing them is not a bug report:

prompts · tags · folders · templates · streaks · social features · plugins ·
graph view · AI-generated writing · live collaborative multiplayer

The reasoning: shizumu is not a notebook you pile into. Features that reward
accumulation, or that turn writing into a performance for an audience, work
against the point. Sink is what makes the writing honest — a page that keeps
everything makes you write for posterity.

Bug reports, correctness fixes, accessibility work, platform packaging, and
performance improvements are all welcome without preamble.

## Building

```bash
npm install
npm run dev             # web frontend at http://localhost:1420
npx tauri dev           # full desktop app
```

Linux (Fedora) needs:

```bash
sudo dnf install webkit2gtk4.1-devel libsoup3-devel javascriptcoregtk4.1-devel gtk3-devel
```

Two version pins are load-bearing and will look arbitrary:

- `@playwright/test` is pinned to an **exact** version because `Dockerfile.vr`
  pins the Playwright image by digest. Playwright refuses to run against a
  mismatched image, so a caret here breaks the visual suite.
- `@zxing/library` must satisfy `@zxing/browser`'s peer range. Loosening it
  reintroduces an ERESOLVE failure that `--legacy-peer-deps` used to mask.

If you regenerate `package-lock.json`, delete `node_modules/` first. Otherwise
npm reuses the installed tree and returns a lockfile with no `resolved` or
`integrity` fields for most packages — which silently breaks offline and
reproducible builds.

## Testing

```bash
npm test                # unit suite
npm run test:rust       # rust backend
npm run test:vr:docker  # visual regression (canonical; needs docker)
```

Run visual tests through Docker. Local runs use different font rendering and
will report failures that aren't real.

Four rules, each written after a defect reached a device despite a green suite:

1. **Decisions go in pure modules, not inside components.** Layout geometry,
   gesture intent, viewport arithmetic, and data-shape conversion each live in
   their own module with unit tests — never inline in a `.svelte` file, where
   nothing can reach them.
2. **A test asserting "nothing happens" must say why.** `expect(fn(x)).toEqual([])`
   is indistinguishable from a bug someone wrote down as correct. Comment why
   the empty result is right, or assert the real behaviour.
3. **`env(safe-area-inset-*)` appears in exactly one place** — the `--safe-*`
   definitions in `src/styles/global.css`. Everything else reads `var(--safe-top)`.
   A surface that re-adds the inset is double-counting.
4. **A phone bug you have to *do* something to see needs a VR interaction state.**
   Load-time screenshots cannot show a revealed block bar or an expanded strip.
   Drive it with real input, never a hook inside the app.

When you add a regression test, prove it: reintroduce the bug, watch it go red,
then restore. A test that does not fail on the bug it was written for is
decoration.

## Interface copy

Any user-facing string follows the project's voice: lowercase, present tense,
fewest words possible. Em-dash for clauses, period for stops, no exclamation
marks. Avoid: productivity, optimize, habit, streak, mindful, journey, growth,
flow (as a standalone noun), future-tense promises, and imperative therapy
("breathe", "reflect").

## Licence

shizumu (this repository, the client) is Apache-2.0. By contributing you agree
your work ships under that licence. Patches applied from issues are committed
by the maintainer, with attribution to you in the commit message. The sync
relay is a separate repository and stays AGPL-3.0-or-later.
