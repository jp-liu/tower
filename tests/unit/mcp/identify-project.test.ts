// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { scoreProject, knowledgeTools } from "@/mcp/tools/knowledge-tools";

const testDb = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_URL ?? "file:./prisma/dev.db" },
  },
});

let workspace1Id: string;
let workspace2Id: string;
let alphaProjectId: string;
let betaProjectId: string;
let gammaProjectId: string;

beforeAll(async () => {
  await testDb.$connect();

  // Create 2 test workspaces
  const workspace1 = await testDb.workspace.create({
    data: { name: "Knowledge Test Workspace 1" },
  });
  workspace1Id = workspace1.id;

  const workspace2 = await testDb.workspace.create({
    data: { name: "Knowledge Test Workspace 2" },
  });
  workspace2Id = workspace2.id;

  // Create projects: Alpha (alias "alp", description "first project") in workspace 1
  const alpha = await testDb.project.create({
    data: {
      name: "Alpha",
      alias: "alp",
      description: "first project",
      workspaceId: workspace1Id,
    },
  });
  alphaProjectId = alpha.id;

  // Beta (alias "bet", description "second alpha project") in workspace 1
  const beta = await testDb.project.create({
    data: {
      name: "Beta",
      alias: "bet",
      description: "second alpha project",
      workspaceId: workspace1Id,
    },
  });
  betaProjectId = beta.id;

  // Gamma (no alias, description "third project") in workspace 2
  const gamma = await testDb.project.create({
    data: {
      name: "Gamma",
      alias: null,
      description: "third project",
      workspaceId: workspace2Id,
    },
  });
  gammaProjectId = gamma.id;
});

afterAll(async () => {
  // Cascade delete via workspace
  await testDb.workspace.delete({ where: { id: workspace1Id } });
  await testDb.workspace.delete({ where: { id: workspace2Id } });
  await testDb.$disconnect();
});

// --- scoreProject unit tests ---

describe("scoreProject", () => {
  it("returns 1.0 for exact name match (case-insensitive)", () => {
    const score = scoreProject({ name: "MyProject", alias: null, description: null }, "myproject");
    expect(score).toBe(1.0);
  });

  it("returns 0.9 for name starts-with match", () => {
    const score = scoreProject({ name: "MyProject", alias: null, description: null }, "my");
    expect(score).toBe(0.9);
  });

  it("returns 0.75 for name contains match", () => {
    const score = scoreProject({ name: "MyProject", alias: null, description: null }, "proj");
    expect(score).toBe(0.75);
  });

  it("returns 0.85 for exact alias match", () => {
    const score = scoreProject({ name: "SomeProject", alias: "mp", description: null }, "mp");
    expect(score).toBe(0.85);
  });

  it("returns 0.75 for alias starts-with match", () => {
    const score = scoreProject({ name: "SomeProject", alias: "mp", description: null }, "m");
    expect(score).toBe(0.75);
  });

  it("returns 0.6 for alias contains match", () => {
    const score = scoreProject({ name: "SomeProject", alias: "myp", description: null }, "yp");
    expect(score).toBe(0.6);
  });

  it("returns 0.4 for description contains match", () => {
    const score = scoreProject({ name: "SomeProject", alias: null, description: "a cool project" }, "cool");
    expect(score).toBe(0.4);
  });

  it("returns 0.0 for no match", () => {
    const score = scoreProject({ name: "X", alias: null, description: null }, "zzz");
    expect(score).toBe(0.0);
  });

  it("name match (0.75) ranks higher than alias match (0.6) for same query", () => {
    // Name contains "yp" (0.75) vs alias contains "yp" (0.6)
    const nameContainsScore = scoreProject({ name: "MyProject", alias: "xyz", description: null }, "yp");
    const aliasContainsScore = scoreProject({ name: "SomeProject", alias: "myp", description: null }, "yp");
    // nameContains = 0.75, aliasContains = 0.6
    expect(nameContainsScore).toBeGreaterThan(aliasContainsScore);
  });
});

// --- identify_project handler integration tests ---

describe("identify_project handler", () => {
  it("query 'alpha' returns Alpha first (name match) and Beta second (description match)", async () => {
    const handler = knowledgeTools.identify_project.handler;
    const results = await handler({ query: "alpha" });

    expect(results.length).toBeGreaterThanOrEqual(2);
    // Alpha should be first (name match = higher confidence)
    const alphaResult = results.find((r) => r.projectId === alphaProjectId);
    const betaResult = results.find((r) => r.projectId === betaProjectId);
    expect(alphaResult).toBeDefined();
    expect(betaResult).toBeDefined();
    expect(alphaResult!.confidence).toBeGreaterThan(betaResult!.confidence);
    // Alpha should come before Beta in sorted results
    const alphaIndex = results.indexOf(alphaResult!);
    const betaIndex = results.indexOf(betaResult!);
    expect(alphaIndex).toBeLessThan(betaIndex);
  });

  it("query 'alp' returns Alpha (alias exact or name starts-with, whichever is higher)", async () => {
    const handler = knowledgeTools.identify_project.handler;
    const results = await handler({ query: "alp" });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].projectId).toBe(alphaProjectId);
    // Alpha: name starts-with = 0.9, alias exact = 0.85 → max = 0.9
    expect(results[0].confidence).toBe(0.9);
  });

  it("query 'zzzzz' returns empty array (below confidence threshold)", async () => {
    const handler = knowledgeTools.identify_project.handler;
    const results = await handler({ query: "zzzzz" });
    expect(results).toEqual([]);
  });

  it("with workspaceId for workspace2, query 'project' returns only Gamma", async () => {
    const handler = knowledgeTools.identify_project.handler;
    const results = await handler({ query: "project", workspaceId: workspace2Id });

    expect(results.length).toBeGreaterThan(0);
    const ids = results.map((r) => r.projectId);
    expect(ids).toContain(gammaProjectId);
    expect(ids).not.toContain(alphaProjectId);
    expect(ids).not.toContain(betaProjectId);
  });

  it("with no workspaceId searches all workspaces", async () => {
    const handler = knowledgeTools.identify_project.handler;
    // "project" matches descriptions of Alpha, Beta, Gamma
    const results = await handler({ query: "project" });

    const ids = results.map((r) => r.projectId);
    expect(ids).toContain(gammaProjectId);
    // Beta also has "project" in desc: "second alpha project"
    expect(ids).toContain(betaProjectId);
  });

  it("results contain required fields", async () => {
    const handler = knowledgeTools.identify_project.handler;
    const results = await handler({ query: "alpha" });

    expect(results.length).toBeGreaterThan(0);
    const result = results[0];
    expect(result).toHaveProperty("projectId");
    expect(result).toHaveProperty("name");
    expect(result).toHaveProperty("alias");
    expect(result).toHaveProperty("workspaceId");
    expect(result).toHaveProperty("workspaceName");
    expect(result).toHaveProperty("confidence");
    expect(typeof result.confidence).toBe("number");
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("results are sorted by confidence DESC", async () => {
    const handler = knowledgeTools.identify_project.handler;
    const results = await handler({ query: "alpha" });

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].confidence).toBeGreaterThanOrEqual(results[i].confidence);
    }
  });

  it("filters out results below 0.3 confidence", async () => {
    const handler = knowledgeTools.identify_project.handler;
    const results = await handler({ query: "alpha" });

    for (const result of results) {
      expect(result.confidence).toBeGreaterThanOrEqual(0.3);
    }
  });
});
