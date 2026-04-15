import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { workspaceTools } from "./tools/workspace-tools";
import { projectTools } from "./tools/project-tools";
import { taskTools } from "./tools/task-tools";
import { labelTools } from "./tools/label-tools";
import { searchTools } from "./tools/search-tools";
import { knowledgeTools } from "./tools/knowledge-tools";
import { noteAssetTools } from "./tools/note-asset-tools";
import { terminalTools } from "./tools/terminal-tools";

export function createServer(): McpServer {
  const server = new McpServer({ name: "tower", version: "0.1.0" });

  const allTools = {
    ...workspaceTools,
    ...projectTools,
    ...taskTools,
    ...labelTools,
    ...searchTools,
    ...knowledgeTools,
    ...noteAssetTools,
    ...terminalTools,
  };

  for (const [name, tool] of Object.entries(allTools)) {
    server.tool(
      name,
      tool.description,
      tool.schema.shape,
      async (args: Record<string, unknown>) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = await (tool.handler as (args: any) => Promise<unknown>)(args);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          return {
            isError: true,
            content: [{ type: "text" as const, text: errorMessage }],
          };
        }
      }
    );
  }

  return server;
}
