import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
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

  const workspace = await prisma.workspace.create({
    data: {
      name: "测试",
      description: "📋",
    },
  });

  const project = await prisma.project.create({
    data: {
      name: "Test",
      alias: "测试项目",
      description: "这是一个测试项目，用于验证平台功能",
      type: "NORMAL",
      workspaceId: workspace.id,
    },
  });

  await prisma.task.create({
    data: {
      title: "测试",
      description:
        "Improve code structure and maintainability without changing functionality.\n\n## Refactoring Checklist\n\n### 1. Identify Refactoring Targets\n- Review code for duplicated logic\n- Find functions exceeding 50 lines\n- Identify deeply nested conditionals",
      status: "IN_REVIEW",
      priority: "MEDIUM",
      order: 0,
      projectId: project.id,
    },
  });

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
