// Pin TOWER_DATA_DIR before anything imports @prisma/client (which auto-loads
// the repo's dev .env). Keep this as the FIRST import — see env-guard.ts.
import "./env-guard";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server";
import { initDb } from "./db";
import { parseMcpToolProfile } from "./tool-capabilities";

async function main() {
  const profile = parseMcpToolProfile(process.env.TOWER_MCP_PROFILE);
  await initDb();
  const server = createServer(profile);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("MCP Server failed to start:", error);
  process.exit(1);
});
