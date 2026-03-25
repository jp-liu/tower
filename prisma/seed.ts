import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.taskMessage.deleteMany();
  await prisma.taskExecution.deleteMany();
  await prisma.task.deleteMany();
  await prisma.repository.deleteMany();
  await prisma.project.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.agentConfig.deleteMany();

  const workspace = await prisma.workspace.create({
    data: {
      name: "测试",
      description: "测试工作空间",
    },
  });

  const project = await prisma.project.create({
    data: {
      name: "Test",
      description: "测试项目",
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
