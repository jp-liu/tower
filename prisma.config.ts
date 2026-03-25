import path from "node:path";
import { defineConfig } from "prisma/config";

export default defineConfig({
  // @ts-ignore earlyAccess is valid at runtime but missing from type defs
  earlyAccess: true,
  schema: path.join(__dirname, "prisma", "schema.prisma"),
  migrate: {
    async url() {
      return process.env.DATABASE_URL ?? "";
    },
  },
});
