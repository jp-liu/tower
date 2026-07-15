import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Clear existing seed data (idempotent re-seed)
  await prisma.taskLabel.deleteMany();
  await prisma.taskMessage.deleteMany();
  await prisma.taskExecution.deleteMany();
  await prisma.task.deleteMany();
  await prisma.label.deleteMany();
  await prisma.repository.deleteMany();
  await prisma.project.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.agentConfig.deleteMany();

  // System-level labels (workspaceId null = visible in every workspace). Only
  // Tower is `isBuiltin` — that flag is purely a "cannot edit/delete" guard, as
  // Tower is a machine marker Tower itself puts on workbench tasks.
  //
  // prd / bug are ordinary starter labels users may rename, delete or re-prefix.
  // They are named in English because locale lives in the browser's
  // localStorage and does not exist yet at install time; their branch prefixes
  // are seeded so a fresh install sees feature/<task id> without a detour
  // through settings.
  await prisma.label.create({ data: { name: "prd", color: "#3b82f6", branchPrefix: "feature" } });
  await prisma.label.create({ data: { name: "bug", color: "#ef4444", branchPrefix: "fix" } });
  await prisma.label.create({ data: { name: "Tower", color: "#8b5cf6", isBuiltin: true } });

  // Default agent config
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

  // Default workspace — ensures at least one workspace always exists
  await prisma.workspace.create({
    data: { name: "我的工作区" },
  });

  console.log("Seed completed successfully");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
