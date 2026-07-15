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
  // Tower is a machine marker Tower itself puts on workbench tasks. The others
  // are ordinary labels users may rename, delete, or give a branchPrefix.
  await prisma.label.create({ data: { name: "需求", color: "#3b82f6" } });
  await prisma.label.create({ data: { name: "缺陷", color: "#ef4444" } });
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
