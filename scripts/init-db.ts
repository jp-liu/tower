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
  // Tower's own marker on workbench tasks — looked up by name, `isBuiltin` being
  // the "cannot edit/delete" guard. It must exist, so create it if missing.
  const tower = await prisma.label.findFirst({ where: { name: "Tower", workspaceId: null } });
  if (!tower) {
    await prisma.label.create({
      data: { name: "Tower", color: "#8b5cf6", isBuiltin: true },
    });
    console.log("Created system label: Tower");
  }

  // Starter labels, only on a database that has no labels of its own yet.
  //
  // Not per-name "create if missing": an existing install has its own set (it
  // may have renamed or deleted these), and looking up names it never had would
  // hand it a second, duplicate pair with the same meaning.
  //
  // English names because locale lives in the browser's localStorage and does
  // not exist yet here, at install time on the server. Prefixes are seeded so a
  // fresh install sees feature/<task id> without a detour through settings.
  const ownLabelCount = await prisma.label.count({ where: { name: { not: "Tower" } } });
  if (ownLabelCount === 0) {
    await prisma.label.createMany({
      data: [
        { name: "prd", color: "#3b82f6", branchPrefix: "feature" },
        { name: "bug", color: "#ef4444", branchPrefix: "fix" },
      ],
    });
    console.log("Created starter labels: prd, bug");
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
