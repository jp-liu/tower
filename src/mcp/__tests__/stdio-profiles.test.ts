// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import { MCP_TOOL_PROFILES, toolProfileNames } from "../tool-capabilities";

describe("MCP stdio profiles", () => {
  it("completes a tools/list handshake for every profile", async () => {
    for (const profile of MCP_TOOL_PROFILES) {
      const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `tower-mcp-${profile}-`));
      const transport = new StdioClientTransport({
        command: path.join(process.cwd(), "node_modules", ".bin", "tsx"),
        args: [path.join(process.cwd(), "src", "mcp", "index.ts")],
        cwd: process.cwd(),
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          TOWER_DATA_DIR: dataDir,
          DATABASE_URL: `file:${path.join(dataDir, "database", "tower.db")}`,
          TOWER_MCP_PROFILE: profile,
        },
        stderr: "pipe",
      });
      const client = new Client({ name: "tower-profile-smoke", version: "1.0.0" });

      try {
        await client.connect(transport);
        const result = await client.listTools();
        expect(result.tools.map((tool) => tool.name).sort()).toEqual(
          [...toolProfileNames[profile]].sort(),
        );
      } finally {
        await client.close();
        fs.rmSync(dataDir, { recursive: true, force: true });
      }
    }
  }, 30_000);

  it("fails startup for an unknown profile", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tower-mcp-invalid-"));
    const transport = new StdioClientTransport({
      command: path.join(process.cwd(), "node_modules", ".bin", "tsx"),
      args: [path.join(process.cwd(), "src", "mcp", "index.ts")],
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        TOWER_DATA_DIR: dataDir,
        DATABASE_URL: `file:${path.join(dataDir, "database", "tower.db")}`,
        TOWER_MCP_PROFILE: "unknown-profile",
      },
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const client = new Client({ name: "tower-profile-smoke", version: "1.0.0" });

    try {
      await expect(client.connect(transport)).rejects.toThrow();
      expect(stderr).toContain("Unknown TOWER_MCP_PROFILE");
    } finally {
      await client.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  }, 10_000);
});
