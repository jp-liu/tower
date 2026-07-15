/**
 * Idempotent database initialization for `tower init`.
 * Unlike seed.ts (which clears all data), this only creates
 * missing builtin records — safe for existing databases.
 */

import { PrismaClient } from "@prisma/client";

if (!process.env.DATABASE_URL) {
  console.error("Error: DATABASE_URL is not set. Run via `tower init` or set DATABASE_URL.");
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  // System-level labels (workspaceId null = visible in every workspace) — create
  // only if missing. Only Tower is `isBuiltin`: that flag is purely a "cannot
  // edit/delete" guard for the marker Tower puts on its own workbench tasks. The
  // others are ordinary labels users may delete or give a branchPrefix.
  const systemLabels = [
    { name: "需求", color: "#3b82f6" },
    { name: "缺陷", color: "#ef4444" },
    { name: "Tower", color: "#8b5cf6", isBuiltin: true },
  ];

  for (const label of systemLabels) {
    const existing = await prisma.label.findFirst({
      where: { name: label.name, workspaceId: null },
    });
    if (!existing) {
      await prisma.label.create({ data: label });
      console.log(`Created system label: ${label.name}`);
    }
  }

  // Default agent config
  const existingConfig = await prisma.agentConfig.findFirst({
    where: { agent: "CLAUDE_CODE", isDefault: true },
  });
  if (!existingConfig) {
    await prisma.agentConfig.create({
      data: {
        agent: "CLAUDE_CODE",
        configName: "DEFAULT",
        isDefault: true,
        settings: JSON.stringify({
          model: "claude-sonnet-4-6",
          maxTokens: 8096,
        }),
      },
    });
    console.log("Created default agent config");
  }

  // Default workspace — ensure at least one exists
  const workspaceCount = await prisma.workspace.count();
  if (workspaceCount === 0) {
    await prisma.workspace.create({
      data: { name: "My Workspace" },
    });
    console.log("Created default workspace");
  }

  console.log("Database initialization complete");
}

main()
  .catch((e) => {
    console.error("Init failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
