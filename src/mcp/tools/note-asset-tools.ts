import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import { db } from "../db";
import { searchNotes, syncNoteToFts, deleteNoteFromFts } from "@/lib/fts";
import { ensureAssetsDir } from "@/lib/file-utils";

// ─── manage_notes ────────────────────────────────────────────────────────────

const manageNotesSchema = z.object({
  action: z.enum(["create", "update", "delete", "get", "list", "search"]),
  projectId: z.string().optional(),
  noteId: z.string().optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  category: z.string().optional(),
  query: z.string().optional(),
});

type ManageNotesArgs = z.infer<typeof manageNotesSchema>;

async function handleManageNotes(args: ManageNotesArgs) {
  switch (args.action) {
    case "create": {
      if (!args.projectId || !args.title) {
        throw new Error("projectId and title required");
      }
      const note = await db.projectNote.create({
        data: {
          title: args.title,
          content: args.content ?? "",
          category: args.category ?? "备忘",
          projectId: args.projectId,
        },
      });
      await syncNoteToFts(db, { id: note.id, title: note.title, content: note.content });
      return note;
    }

    case "update": {
      if (!args.noteId) {
        throw new Error("noteId required");
      }
      const updateData: { title?: string; content?: string; category?: string } = {};
      if (args.title !== undefined) updateData.title = args.title;
      if (args.content !== undefined) updateData.content = args.content;
      if (args.category !== undefined) updateData.category = args.category;

      const note = await db.projectNote.update({
        where: { id: args.noteId },
        data: updateData,
      });
      await syncNoteToFts(db, { id: note.id, title: note.title, content: note.content });
      return note;
    }

    case "delete": {
      if (!args.noteId) {
        throw new Error("noteId required");
      }
      await deleteNoteFromFts(db, args.noteId);
      await db.projectNote.delete({ where: { id: args.noteId } });
      return { deleted: true, noteId: args.noteId };
    }

    case "get": {
      if (!args.noteId) {
        throw new Error("noteId required");
      }
      return db.projectNote.findUnique({ where: { id: args.noteId } });
    }

    case "list": {
      if (!args.projectId) {
        throw new Error("projectId required");
      }
      const where: { projectId: string; category?: string } = { projectId: args.projectId };
      if (args.category) where.category = args.category;

      return db.projectNote.findMany({
        where,
        orderBy: { updatedAt: "desc" },
      });
    }

    case "search": {
      if (!args.projectId || !args.query) {
        throw new Error("projectId and query required");
      }
      return searchNotes(db, args.projectId, args.query);
    }

    default:
      throw new Error(`Unknown action: ${args.action}`);
  }
}

// ─── manage_assets ───────────────────────────────────────────────────────────

const manageAssetsSchema = z.object({
  action: z.enum(["add", "delete", "list", "get"]),
  projectId: z.string().optional(),
  assetId: z.string().optional(),
  sourcePath: z.string().optional(),
  filename: z.string().optional(),
});

type ManageAssetsArgs = z.infer<typeof manageAssetsSchema>;

async function handleManageAssets(args: ManageAssetsArgs) {
  switch (args.action) {
    case "add": {
      if (!args.projectId || !args.sourcePath) {
        throw new Error("projectId and sourcePath required");
      }
      const assetsDir = ensureAssetsDir(args.projectId);
      const filename = args.filename ?? path.basename(args.sourcePath);
      const destPath = path.join(assetsDir, filename);

      // Move file: try rename first, fall back to copy+delete for cross-device
      try {
        fs.renameSync(args.sourcePath, destPath);
      } catch (err) {
        const nodeErr = err as NodeJS.ErrnoException;
        if (nodeErr.code === "EXDEV") {
          fs.copyFileSync(args.sourcePath, destPath);
          fs.unlinkSync(args.sourcePath);
        } else {
          throw err;
        }
      }

      const stats = fs.statSync(destPath);
      const asset = await db.projectAsset.create({
        data: {
          filename,
          path: destPath,
          size: stats.size,
          projectId: args.projectId,
        },
      });
      return asset;
    }

    case "delete": {
      if (!args.assetId) {
        throw new Error("assetId required");
      }
      await db.projectAsset.delete({ where: { id: args.assetId } });
      return { deleted: true, assetId: args.assetId };
    }

    case "list": {
      if (!args.projectId) {
        throw new Error("projectId required");
      }
      return db.projectAsset.findMany({
        where: { projectId: args.projectId },
        orderBy: { createdAt: "desc" },
      });
    }

    case "get": {
      if (!args.assetId) {
        throw new Error("assetId required");
      }
      return db.projectAsset.findUnique({ where: { id: args.assetId } });
    }

    default:
      throw new Error(`Unknown action: ${args.action}`);
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const noteAssetTools = {
  manage_notes: {
    description:
      "Create, read, update, delete, or search project notes. Use action field to select operation.",
    schema: manageNotesSchema,
    handler: handleManageNotes,
  },
  manage_assets: {
    description:
      "Add, delete, list, or get project assets. action=add moves a file from sourcePath into managed storage.",
    schema: manageAssetsSchema,
    handler: handleManageAssets,
  },
};
