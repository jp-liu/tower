import { z } from "zod";
import { isValidBranchPrefix } from "@/lib/worktree-branch";

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

export const reorderWorkspacesSchema = z
  .array(cuid)
  .min(1, "At least one workspace id is required");

// ── Project schemas ──
export const createProjectSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  alias: z.string().max(100).optional(),
  description: z.string().max(5000).optional(),
  gitUrl: z.string().max(500).optional().or(z.literal("")),
  localPath: z.string().optional(),
  workspaceId: cuid,
  projectType: z.enum(["FRONTEND", "BACKEND"]).optional(),
  previewCommand: z.string().max(500).nullable().optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  alias: z.string().max(100).optional(),
  description: z.string().max(5000).optional(),
  localPath: z.string().optional(),
  projectType: z.enum(["FRONTEND", "BACKEND"]).optional(),
  previewCommand: z.string().max(500).nullable().optional(),
  previewPort: z.number().int().min(1).max(65535).nullable().optional(),
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
  versionId: cuid.optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  labelIds: z.array(cuid).optional(),
  baseBranch: z.string().max(200).optional(),
  subPath: z.string().max(500).optional(),
  previewCommandOverride: z.string().max(500).nullable().optional(),
  previewPortOverride: z.number().int().min(1).max(65535).nullable().optional(),
  versionId: cuid.nullable().optional(),
});

export const taskStatusSchema = z.enum(["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"]);

// ── Label schemas ──
const labelName = z.string().min(1, "Name is required").max(50);
// Same bar as the branch prefix on update — one field, one validity standard.
const labelBranchPrefix = z
  .string()
  .max(100)
  .refine(isValidBranchPrefix, "Invalid branch prefix")
  .nullable()
  .optional();
// Free-text hint on what tasks the label fits; read by create_task to pick by meaning.
const labelDescription = z.string().max(200).nullable().optional();

export const createLabelSchema = z.object({
  name: labelName,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Invalid hex color"),
  // null = system-level: visible in every workspace (see getLabelsForWorkspace).
  workspaceId: cuid.nullable(),
  branchPrefix: labelBranchPrefix,
  description: labelDescription,
});

export const updateLabelSchema = z.object({
  name: labelName.optional(),
  branchPrefix: labelBranchPrefix,
  description: labelDescription,
});

// ── Version schemas ──
export const createVersionSchema = z.object({
  number: z.string().min(1, "Number is required").max(50),
  name: z.string().min(1, "Name is required").max(100),
  typeId: cuid.optional(),
  baseBranch: z.string().max(200).optional(),
  startDate: z.coerce.date().optional(),
  targetDate: z.coerce.date().optional(),
  description: z.string().max(5000).optional(),
  projectId: cuid,
  setCurrent: z.boolean().optional(),
});

export const updateVersionSchema = z.object({
  number: z.string().min(1).max(50).optional(),
  name: z.string().min(1).max(100).optional(),
  typeId: cuid.nullable().optional(),
  baseBranch: z.string().max(200).nullable().optional(),
  startDate: z.coerce.date().nullable().optional(),
  targetDate: z.coerce.date().nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
});

// ── VersionType schemas ──
export const createVersionTypeSchema = z.object({
  workspaceId: cuid,
  name: z.string().min(1).max(50),
});

export const updateVersionTypeSchema = z.object({
  name: z.string().min(1).max(50),
});
