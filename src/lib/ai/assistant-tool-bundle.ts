import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ApiRuntimeError, type ApiToolDefinition } from "@tower/ai-runtime";
import { ATTACHMENT_SUBPATH_RE, MAX_ATTACHMENTS, classifyAttachmentSubPath } from "@/lib/attachment-utils";
import { getAssistantCacheRoot } from "@/lib/file-utils";
import { detectImageMime, isLikelyTextFile, TEXT_EXT_TO_MIME } from "@/lib/mime-magic";
import { assistantTowerToolCatalog } from "@/mcp/tool-catalog";

const DEFAULT_MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

type Catalog = Record<string, {
  description: string;
  schema: z.ZodObject;
  handler: (args: never) => Promise<unknown>;
}>;

export interface AssistantToolBundleOptions {
  attachments?: string[];
  attachmentRoot?: string;
  maxAttachmentBytes?: number;
  catalog?: Catalog;
}

function toolError(): ApiRuntimeError {
  return new ApiRuntimeError({
    code: "tool_error",
    message: "A tool execution failed",
    cause: "ToolExecutionError",
    retryableWithNextKey: false,
  });
}

function within(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function attachmentTool(options: Required<Pick<AssistantToolBundleOptions, "attachmentRoot" | "maxAttachmentBytes">> & {
  attachments: string[];
}): ApiToolDefinition {
  const allowed = new Set(options.attachments);
  return {
    description: "Read one attachment explicitly included with the current Assistant message.",
    inputSchema: z.toJSONSchema(z.object({ attachment: z.string() })) as Record<string, unknown>,
    execute: async (input) => {
      try {
        const { attachment } = z.object({ attachment: z.string() }).parse(input);
        if (!allowed.has(attachment) || !ATTACHMENT_SUBPATH_RE.test(attachment)) throw toolError();
        const root = await fs.realpath(options.attachmentRoot);
        const unresolved = path.resolve(root, attachment);
        if (!within(root, unresolved)) throw toolError();
        const resolved = await fs.realpath(unresolved);
        if (!within(root, resolved)) throw toolError();
        const stat = await fs.stat(resolved);
        if (!stat.isFile() || stat.size > options.maxAttachmentBytes) throw toolError();
        const kind = classifyAttachmentSubPath(attachment);
        if (!kind) throw toolError();
        const data = await fs.readFile(resolved);
        if (kind === "image") {
          const mimeType = detectImageMime(data);
          if (!mimeType) throw toolError();
          return {
            _towerAttachment: true,
            attachment,
            mimeType,
            size: data.byteLength,
            content: data.toString("base64"),
          };
        }
        if (!isLikelyTextFile(data)) throw toolError();
        const extension = path.extname(attachment).toLowerCase();
        return {
          _towerAttachment: true,
          attachment,
          mimeType: TEXT_EXT_TO_MIME[extension] ?? "text/plain",
          size: data.byteLength,
          content: data.toString("utf8"),
        };
      } catch (error) {
        if (error instanceof ApiRuntimeError) throw error;
        throw toolError();
      }
    },
  };
}

export function createAssistantToolBundle(options: AssistantToolBundleOptions = {}): Record<string, ApiToolDefinition> {
  const attachments = [...new Set(options.attachments ?? [])];
  if (attachments.length > MAX_ATTACHMENTS || attachments.some((item) => !ATTACHMENT_SUBPATH_RE.test(item))) {
    throw toolError();
  }
  const catalog = options.catalog ?? assistantTowerToolCatalog as unknown as Catalog;
  const tools: Record<string, ApiToolDefinition> = Object.fromEntries(Object.entries(catalog).map(([name, definition]) => [
    name,
    {
      description: definition.description,
      inputSchema: z.toJSONSchema(definition.schema) as Record<string, unknown>,
      execute: async (input: unknown) => {
        try {
          const args = definition.schema.parse(input);
          return await definition.handler(args as never);
        } catch {
          throw toolError();
        }
      },
    } satisfies ApiToolDefinition,
  ]));
  if (attachments.length) {
    tools.read_attachment = attachmentTool({
      attachments,
      attachmentRoot: options.attachmentRoot ?? getAssistantCacheRoot(),
      maxAttachmentBytes: options.maxAttachmentBytes ?? DEFAULT_MAX_ATTACHMENT_BYTES,
    });
  }
  return tools;
}
