import { z } from "zod";

// Shared ID validator
const cuid = z.string().min(1, "ID is required");

// ── Workspace schemas ──
export const createWorkspaceSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().max(500).optional(),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
});

// ── Project schemas ──
export const createProjectSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  alias: z.string().max(100).optional(),
  description: z.string().max(1000).optional(),
  gitUrl: z.string().max(500).optional().or(z.literal("")),
  localPath: z.string().optional(),
  workspaceId: cuid,
  projectType: z.enum(["FRONTEND", "BACKEND"]).optional(),
  previewCommand: z.string().max(500).nullable().optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  alias: z.string().max(100).optional(),
  description: z.string().max(1000).optional(),
  localPath: z.string().optional(),
  projectType: z.enum(["FRONTEND", "BACKEND"]).optional(),
  previewCommand: z.string().max(500).nullable().optional(),
});

// ── Task schemas ──
export const createTaskSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(5000).optional(),
  projectId: cuid,
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  status: z.enum(["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"]).optional(),
  labelIds: z.array(cuid).optional(),
  baseBranch: z.string().max(200).optional(),
  subPath: z.string().max(500).optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  labelIds: z.array(cuid).optional(),
  baseBranch: z.string().max(200).optional(),
  subPath: z.string().max(500).optional(),
});

export const taskStatusSchema = z.enum(["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"]);

// ── Label schemas ──
export const createLabelSchema = z.object({
  name: z.string().min(1, "Name is required").max(50),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Invalid hex color"),
  workspaceId: cuid,
});
