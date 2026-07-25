import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
import os from "os";

// Force a test NODE_ENV regardless of the ambient shell. When the dev/prod
// Tower server runs in the same shell, NODE_ENV=production leaks in; vitest only
// defaults NODE_ENV to "test" when it's unset, so React would otherwise load its
// production build (where `act` is stripped) and every render() test throws
// "React.act is not a function".
(process.env as Record<string, string>).NODE_ENV = "test";

// Throwaway data root for the test run. Everything DB-ish is derived from
// TOWER_DATA_DIR (getTowerDbFilePath), so pinning it here is what keeps tests
// off the user's real ~/.tower database — the app's `db` singleton and any
// test-local PrismaClient both resolve to this directory instead. Keyed by pid
// so concurrent runs never share a file; tests/global-setup.ts creates the
// schema in it and removes the directory afterwards.
const TEST_DATA_DIR = path.join(os.tmpdir(), `tower-test-${process.pid}`);
// Set in this process too: global-setup runs here, not in the test workers.
process.env.TOWER_DATA_DIR = TEST_DATA_DIR;

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // Keep the full release gate deterministic when several Tower worktrees run
    // concurrently. Many suites spawn real git/PTY fixture processes, so even a
    // small fork pool can exhaust worker startup slots and starve 8s smoke waits.
    maxWorkers: 1,
    setupFiles: ["./tests/setup.ts"],
    globalSetup: ["./tests/global-setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}", "src/**/__tests__/**/*.test.{ts,tsx}"],
    env: { NODE_ENV: "test", TOWER_DATA_DIR: TEST_DATA_DIR },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./tests/server-only.ts"),
      "@tower/ai-runtime": path.resolve(__dirname, "./packages/ai-runtime/src/index.ts"),
      "@tower/ai-sdk": path.resolve(__dirname, "./packages/ai-sdk/src/index.ts"),
      "@tower/ai-provider-claude": path.resolve(__dirname, "./packages/ai-provider-claude/src/index.ts"),
      "@tower/ai-provider-codex": path.resolve(__dirname, "./packages/ai-provider-codex/src/index.ts"),
      "@tower/ai-provider-gemini": path.resolve(__dirname, "./packages/ai-provider-gemini/src/index.ts"),
    },
  },
});
