import { PrismaClient } from "@prisma/client";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for the E2E seed");
}

const prisma = new PrismaClient();

async function main() {
  const settings = [
    ["onboarding.completed", "true"],
    ["onboarding.lastStep", "4"],
    ["onboarding.tourCompleted", "true"],
    ["onboarding.username", JSON.stringify("Tower E2E")],
  ] as const;

  for (const [key, value] of settings) {
    await prisma.systemConfig.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  });
