import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@tower/ai-sdk": path.resolve(import.meta.dirname, "../ai-sdk/src/index.ts"),
    },
  },
});
