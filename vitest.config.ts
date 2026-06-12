import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

// Force a test NODE_ENV regardless of the ambient shell. When the dev/prod
// Tower server runs in the same shell, NODE_ENV=production leaks in; vitest only
// defaults NODE_ENV to "test" when it's unset, so React would otherwise load its
// production build (where `act` is stripped) and every render() test throws
// "React.act is not a function".
(process.env as Record<string, string>).NODE_ENV = "test";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}", "src/**/__tests__/**/*.test.{ts,tsx}"],
    env: { NODE_ENV: "test" },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
