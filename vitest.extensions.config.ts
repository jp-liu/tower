import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/lib/extensions/__tests__/**/*.test.ts",
      "packages/extension-*/**/*.test.ts",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./tests/server-only.ts"),
      "@tower-org/ai-runtime": path.resolve(__dirname, "./packages/ai-runtime/src/index.ts"),
      "@tower-org/ai-sdk": path.resolve(__dirname, "./packages/ai-sdk/src/index.ts"),
    },
  },
});

