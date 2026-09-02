import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte({ hot: false })],
  resolve: {
    // Pick Svelte's browser/client entry under jsdom so mount() is available.
    conditions: ["browser"],
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.js", "vite.config.test.js"],
    setupFiles: ["./vitest.setup.js"],
  },
});
