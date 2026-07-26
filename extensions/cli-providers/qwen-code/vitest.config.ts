import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["test/**/*.test.ts"] },
  resolve: {
    alias: {
      "@tower/ai-sdk": path.resolve(import.meta.dirname, "../../../packages/ai-sdk/src/index.ts"),
    },
  },
});
