import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { createRequire } from "node:module";
import { resolve as resolvePath } from "node:path";

const require = createRequire(import.meta.url);
const pkg = require("./package.json");

const host = process.env.TAURI_DEV_HOST;

// A real filesystem absolute path, not the "/src/..." root-relative shorthand
// the plan called for: dev's optimizeDeps pre-bundling step (esbuild, used to
// pre-bundle transitive deps like @tauri-apps/plugin-notification, which
// statically imports @tauri-apps/api/core) resolves alias targets against the
// OS filesystem root rather than the project root, so "/src/..." fails there
// with "Cannot read file: /src/lib/demo/tauri-stub.js" even though Vite's own
// module graph resolves it fine. Same destination file, a path shape that
// works in both resolvers.
const tauriStub = resolvePath(import.meta.dirname, "src/lib/demo/tauri-stub.js");
const unreachableStub = resolvePath(import.meta.dirname, "src/lib/demo/unreachable.svelte");

export default defineConfig(async ({ mode } = {}) => {
  const isDemo = mode === "demo";

  // The demo used to be switched on by two independent things: this file's
  // own `mode === "demo"` (gating base/outDir/the alias below) and the
  // VITE_DEMO env define that src/lib/demo/bootstrap.js reads at runtime
  // (import.meta.env.VITE_DEMO, exposed automatically because the name is
  // VITE_-prefixed). `npm run build:demo` set both, so the built artifact
  // was fine, but nothing forced dev to: `VITE_DEMO=1 npm run dev` (the
  // locally-documented way to run the demo) applied the define without
  // ever passing `--mode demo`, so the alias below never ran and every
  // direct-to-Tauri call site threw again in the browser - the seam
  // appeared to regress.
  //
  // The derivation below has to run in both directions, not just one:
  // `mode` decides VITE_DEMO outright, whatever the environment already
  // holds. Setting it only when isDemo (and leaving it alone otherwise)
  // was a one-way derivation - a VITE_DEMO=1 already sitting in the shell
  // or a CI job's environment would survive untouched into a plain
  // `vite build`, and the demo (copy, DemoStrip, the whole module graph)
  // would leak into a production/Tauri bundle at base "/". Deleting it
  // outright in every non-demo mode is what actually makes the demo mode
  // the one switch, in both directions.
  if (isDemo) {
    process.env.VITE_DEMO = process.env.VITE_DEMO || "1";
  } else {
    delete process.env.VITE_DEMO;
  }

  return {
    plugins: [svelte()],
    clearScreen: false,
    // The browser demo is served from /try/app/ on the website, so its assets
    // must be requested from there rather than from the site root.
    base: isDemo ? "/try/app/" : "/",
    build: isDemo ? { outDir: "dist-demo", emptyOutDir: true } : {},
    // Redirects the handful of app modules that reach @tauri-apps directly
    // (rather than through src/lib/api.js) to a browser-safe stub in the demo
    // build only. See src/lib/demo/tauri-stub.js for why a module seam beats
    // guarding every call site.
    //
    // Onboarding.svelte and Playground.svelte are aliased to a shared no-op
    // stub (src/lib/demo/unreachable.svelte) for a different reason: the demo
    // never renders either (the fixture marks onboarding complete; the
    // playground gallery is dev-only), but Rollup still bundles them because
    // App.svelte reaches Playground through a `$state`-gated dynamic import
    // it cannot prove dead. Both files still carry the word retired from
    // user-facing copy (see CLAUDE.md's "Retired word" section), so leaving
    // them in a public bundle isn't just dead weight, it ships that word to
    // anyone reading the served JS.
    //
    // Plain string keys, matching the exact specifiers App.svelte writes
    // ("./components/Onboarding.svelte" as a static import,
    // "./components/Playground.svelte" as a dynamic import()) - confirmed by
    // building the demo and grepping dist-demo/ for both component names and
    // the retired word: neither survives. A regex `find` (which would force
    // the array form of resolve.alias, since RegExp keys are coerced to
    // strings in a plain object) was tried first in case a bare relative
    // specifier proved unreliable to alias; it did not, so the simpler form
    // stands - a regex here would guard against a rename this file has no
    // other way to detect anyway, at the cost of a resolver working on
    // string equality diverging in mechanism from the object keys beside it.
    resolve: isDemo ? {
      alias: {
        "@tauri-apps/api/core": tauriStub,
        "@tauri-apps/api/event": tauriStub,
        "@tauri-apps/api/app": tauriStub,
        "@tauri-apps/plugin-dialog": tauriStub,
        "./components/Onboarding.svelte": unreachableStub,
        "./components/Playground.svelte": unreachableStub,
      },
    } : {},
    define: {
      // Vite's own loadEnv reads a project-root .env file and exposes any
      // VITE_-prefixed key as import.meta.env.VITE_DEMO independently of
      // what this factory does to process.env above - a .env a developer
      // created locally (gitignored, so nothing here would ever see it)
      // would otherwise survive into a `vite build` untouched, and because
      // invoke-source.js's precedence puts demo above Tauri, a shipped
      // Tauri build would boot the mock over the real backend. define runs
      // at the bundler level, ahead of that lookup, so this is the one
      // place mode decides VITE_DEMO that a .env cannot reach around.
      "import.meta.env.VITE_DEMO": JSON.stringify(isDemo ? "1" : ""),
      __APP_VERSION__: JSON.stringify(pkg.version),
      // The build's commit, so a screenshot identifies the exact build.
      // A version string alone cannot: a tag can be moved (v0.6.11 was
      // re-cut six times during the mobile work), and every one of those
      // builds reported the same version while containing different fixes —
      // which made "is this fixed?" unanswerable from the device. CI exports
      // CI_COMMIT_SHORT_SHA; a local build falls back to "dev".
      __BUILD_SHA__: JSON.stringify(
        process.env.CI_COMMIT_SHORT_SHA || process.env.BUILD_SHA || "dev"
      ),
    },
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        ignored: [
          "**/src-tauri/**",
          "**/build-dir/**",
          "**/flatpak/build-dir/**",
          "**/.flatpak-builder/**",
          "**/marketing/**",
          "**/.git/**",
        ],
      },
    },
  };
});
