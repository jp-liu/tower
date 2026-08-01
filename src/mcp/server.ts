import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTowerToolCatalog, type McpToolProfile } from "./tool-catalog";

export function createServer(profile: McpToolProfile | string | undefined = "full"): McpServer {
  const server = new McpServer({ name: "tower", version: "0.1.0" });

  for (const [name, tool] of Object.entries(getTowerToolCatalog(profile))) {
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
          void error;
          return {
            isError: true,
            content: [{ type: "text" as const, text: "Tool execution failed" }],
          };
        }
      }
    );
  }

  return server;
}
