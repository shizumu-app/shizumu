import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("./package.json");

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [svelte()],
  clearScreen: false,
  define: {
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
}));
