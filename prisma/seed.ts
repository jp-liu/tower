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
  await prisma.cliProfile.deleteMany();

  // Built-in labels (no workspace = global)
  await prisma.label.create({ data: { name: "需求", color: "#3b82f6", isBuiltin: true } });
  await prisma.label.create({ data: { name: "缺陷", color: "#ef4444", isBuiltin: true } });

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

  // Default CLI Profile — used by startPtyExecution/resumePtyExecution
  await prisma.cliProfile.upsert({
    where: { name: "default" },
    update: {},
    create: {
      name: "default",
      command: "claude",
      baseArgs: JSON.stringify(["--dangerously-skip-permissions"]),
      envVars: JSON.stringify({}),
      isDefault: true,
    },
  });

  // NOTE: No test workspace/project/task created.
  // New users go through the onboarding wizard (Phase 67) which guides
  // them to create their first workspace.

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
