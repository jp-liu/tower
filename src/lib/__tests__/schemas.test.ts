import { describe, it, expect } from "vitest";
import {
  createWorkspaceSchema,
  updateWorkspaceSchema,
  createProjectSchema,
  updateProjectSchema,
  createTaskSchema,
  updateTaskSchema,
  taskStatusSchema,
  createLabelSchema,
} from "../schemas";

// ── createWorkspaceSchema ──

describe("createWorkspaceSchema", () => {
  it("accepts valid name only", () => {
    const result = createWorkspaceSchema.safeParse({ name: "My Workspace" });
    expect(result.success).toBe(true);
  });

  it("accepts valid name with description", () => {
    const result = createWorkspaceSchema.safeParse({
      name: "My Workspace",
      description: "A description",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = createWorkspaceSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects name over 100 chars", () => {
    const result = createWorkspaceSchema.safeParse({ name: "a".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("accepts name exactly 100 chars", () => {
    const result = createWorkspaceSchema.safeParse({ name: "a".repeat(100) });
    expect(result.success).toBe(true);
  });

  it("rejects description over 500 chars", () => {
    const result = createWorkspaceSchema.safeParse({
      name: "Test",
      description: "a".repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it("accepts description exactly 500 chars", () => {
    const result = createWorkspaceSchema.safeParse({
      name: "Test",
      description: "a".repeat(500),
    });
    expect(result.success).toBe(true);
  });
});

// ── updateWorkspaceSchema ──

describe("updateWorkspaceSchema", () => {
  it("accepts empty object (all fields optional)", () => {
    const result = updateWorkspaceSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts partial update with name only", () => {
    const result = updateWorkspaceSchema.safeParse({ name: "New Name" });
    expect(result.success).toBe(true);
  });

  it("rejects name empty string (min 1 when provided)", () => {
    const result = updateWorkspaceSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects name over 100 chars", () => {
    const result = updateWorkspaceSchema.safeParse({ name: "a".repeat(101) });
    expect(result.success).toBe(false);
  });
});

// ── createProjectSchema ──

describe("createProjectSchema", () => {
  const validBase = {
    name: "My Project",
    workspaceId: "clh1234567890abcdefghij",
  };

  it("accepts valid minimal project", () => {
    const result = createProjectSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = createProjectSchema.safeParse({ ...validBase, name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects name over 100 chars", () => {
    const result = createProjectSchema.safeParse({
      ...validBase,
      name: "a".repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid projectType FRONTEND", () => {
    const result = createProjectSchema.safeParse({
      ...validBase,
      projectType: "FRONTEND",
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid projectType BACKEND", () => {
    const result = createProjectSchema.safeParse({
      ...validBase,
      projectType: "BACKEND",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid projectType FULLSTACK", () => {
    const result = createProjectSchema.safeParse({
      ...validBase,
      projectType: "FULLSTACK",
    });
    expect(result.success).toBe(false);
  });

  it("accepts empty string for gitUrl", () => {
    const result = createProjectSchema.safeParse({ ...validBase, gitUrl: "" });
    expect(result.success).toBe(true);
  });

  it("accepts valid gitUrl", () => {
    const result = createProjectSchema.safeParse({
      ...validBase,
      gitUrl: "https://github.com/user/repo",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty workspaceId", () => {
    const result = createProjectSchema.safeParse({ name: "Test", workspaceId: "" });
    expect(result.success).toBe(false);
  });
});

// ── createTaskSchema ──

describe("createTaskSchema", () => {
  const validBase = {
    title: "Fix the bug",
    projectId: "clh1234567890abcdefghij",
  };

  it("accepts valid minimal task", () => {
    const result = createTaskSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });

  it("rejects empty title", () => {
    const result = createTaskSchema.safeParse({ ...validBase, title: "" });
    expect(result.success).toBe(false);
  });

  it("rejects title over 200 chars", () => {
    const result = createTaskSchema.safeParse({
      ...validBase,
      title: "a".repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it("accepts title exactly 200 chars", () => {
    const result = createTaskSchema.safeParse({
      ...validBase,
      title: "a".repeat(200),
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid priority LOW", () => {
    const result = createTaskSchema.safeParse({ ...validBase, priority: "LOW" });
    expect(result.success).toBe(true);
  });

  it("accepts valid priority MEDIUM", () => {
    const result = createTaskSchema.safeParse({ ...validBase, priority: "MEDIUM" });
    expect(result.success).toBe(true);
  });

  it("accepts valid priority HIGH", () => {
    const result = createTaskSchema.safeParse({ ...validBase, priority: "HIGH" });
    expect(result.success).toBe(true);
  });

  it("accepts valid priority CRITICAL", () => {
    const result = createTaskSchema.safeParse({ ...validBase, priority: "CRITICAL" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid priority URGENT", () => {
    const result = createTaskSchema.safeParse({ ...validBase, priority: "URGENT" });
    expect(result.success).toBe(false);
  });

  it("accepts valid status TODO", () => {
    const result = createTaskSchema.safeParse({ ...validBase, status: "TODO" });
    expect(result.success).toBe(true);
  });

  it("accepts valid status IN_PROGRESS", () => {
    const result = createTaskSchema.safeParse({ ...validBase, status: "IN_PROGRESS" });
    expect(result.success).toBe(true);
  });

  it("accepts valid status IN_REVIEW", () => {
    const result = createTaskSchema.safeParse({ ...validBase, status: "IN_REVIEW" });
    expect(result.success).toBe(true);
  });

  it("accepts valid status DONE", () => {
    const result = createTaskSchema.safeParse({ ...validBase, status: "DONE" });
    expect(result.success).toBe(true);
  });

  it("accepts valid status CANCELLED", () => {
    const result = createTaskSchema.safeParse({ ...validBase, status: "CANCELLED" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid status UNKNOWN", () => {
    const result = createTaskSchema.safeParse({ ...validBase, status: "UNKNOWN" });
    expect(result.success).toBe(false);
  });

  it("rejects empty projectId", () => {
    const result = createTaskSchema.safeParse({ title: "Test", projectId: "" });
    expect(result.success).toBe(false);
  });
});

// ── updateTaskSchema ──

describe("updateTaskSchema", () => {
  it("accepts empty object (all fields optional)", () => {
    const result = updateTaskSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects title empty string when provided (min 1)", () => {
    const result = updateTaskSchema.safeParse({ title: "" });
    expect(result.success).toBe(false);
  });

  it("accepts valid partial update", () => {
    const result = updateTaskSchema.safeParse({ title: "New title", priority: "HIGH" });
    expect(result.success).toBe(true);
  });

  it("rejects title over 200 chars", () => {
    const result = updateTaskSchema.safeParse({ title: "a".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("rejects invalid priority when provided", () => {
    const result = updateTaskSchema.safeParse({ priority: "URGENT" });
    expect(result.success).toBe(false);
  });
});

// ── taskStatusSchema ──

describe("taskStatusSchema", () => {
  it("accepts TODO", () => {
    expect(taskStatusSchema.safeParse("TODO").success).toBe(true);
  });

  it("accepts IN_PROGRESS", () => {
    expect(taskStatusSchema.safeParse("IN_PROGRESS").success).toBe(true);
  });

  it("accepts IN_REVIEW", () => {
    expect(taskStatusSchema.safeParse("IN_REVIEW").success).toBe(true);
  });

  it("accepts DONE", () => {
    expect(taskStatusSchema.safeParse("DONE").success).toBe(true);
  });

  it("accepts CANCELLED", () => {
    expect(taskStatusSchema.safeParse("CANCELLED").success).toBe(true);
  });

  it("rejects UNKNOWN", () => {
    expect(taskStatusSchema.safeParse("UNKNOWN").success).toBe(false);
  });

  it("rejects empty string", () => {
    expect(taskStatusSchema.safeParse("").success).toBe(false);
  });

  it("rejects lowercase todo", () => {
    expect(taskStatusSchema.safeParse("todo").success).toBe(false);
  });
});

// ── createLabelSchema ──

describe("createLabelSchema", () => {
  const validBase = {
    name: "Bug",
    color: "#aabbcc",
    workspaceId: "clh1234567890abcdefghij",
  };

  it("accepts valid label with lowercase hex", () => {
    const result = createLabelSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });

  it("accepts valid label with uppercase hex #AABBCC", () => {
    const result = createLabelSchema.safeParse({ ...validBase, color: "#AABBCC" });
    expect(result.success).toBe(true);
  });

  it("accepts mixed-case hex #AaBbCc", () => {
    const result = createLabelSchema.safeParse({ ...validBase, color: "#AaBbCc" });
    expect(result.success).toBe(true);
  });

  it("rejects color without # prefix (plain 'red')", () => {
    const result = createLabelSchema.safeParse({ ...validBase, color: "red" });
    expect(result.success).toBe(false);
  });

  it("rejects color with invalid hex chars '#GGG000'", () => {
    const result = createLabelSchema.safeParse({ ...validBase, color: "#GGG000" });
    expect(result.success).toBe(false);
  });

  it("rejects short hex '#aabb' (only 4 hex chars)", () => {
    const result = createLabelSchema.safeParse({ ...validBase, color: "#aabb" });
    expect(result.success).toBe(false);
  });

  it("rejects 3-char hex '#abc' (shorthand not allowed)", () => {
    const result = createLabelSchema.safeParse({ ...validBase, color: "#abc" });
    expect(result.success).toBe(false);
  });

  it("rejects name over 50 chars", () => {
    const result = createLabelSchema.safeParse({ ...validBase, name: "a".repeat(51) });
    expect(result.success).toBe(false);
  });

  it("accepts name exactly 50 chars", () => {
    const result = createLabelSchema.safeParse({ ...validBase, name: "a".repeat(50) });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = createLabelSchema.safeParse({ ...validBase, name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects empty workspaceId", () => {
    const result = createLabelSchema.safeParse({ name: "Bug", color: "#aabbcc", workspaceId: "" });
    expect(result.success).toBe(false);
  });
});
