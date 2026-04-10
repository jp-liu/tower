# External Integrations

**Analysis Date:** 2026-03-26

## APIs & External Services

**Claude Code CLI:**
- The primary external integration. The adapter at `src/lib/adapters/claude-local/` spawns `claude` as a child process to execute AI tasks.
- Invoked with: `claude --print - --output-format stream-json --verbose`
- Supports session resumption (`--resume`), model selection (`--model`), and custom system prompts (`--append-system-prompt-file`)
- Process management: `src/lib/adapters/process-manager.ts`, `src/lib/adapters/process-utils.ts`
- Auth: Relies on the user's local Claude CLI authentication (no env var needed)

**Google Fonts:**
- Fonts loaded via `<link>` tags in `src/app/layout.tsx`
- Fonts: DM Sans, JetBrains Mono
- Also uses Next.js `next/font/google` for Geist and Geist Mono

## MCP Server

**Model Context Protocol Server:**
- Entry point: `src/mcp/index.ts`
- Transport: stdio (`StdioServerTransport`)
- Server definition: `src/mcp/server.ts` using `McpServer` from `@modelcontextprotocol/sdk`
- Standalone process (separate PrismaClient instance in `src/mcp/db.ts`)
- 18 tools across 5 categories:
  - Workspace tools: `src/mcp/tools/workspace-tools.ts`
  - Project tools: `src/mcp/tools/project-tools.ts`
  - Task tools: `src/mcp/tools/task-tools.ts`
  - Label tools: `src/mcp/tools/label-tools.ts`
  - Search tools: `src/mcp/tools/search-tools.ts`
- Configuration for MCP clients:
  ```json
  {
    "mcpServers": {
      "ai-manager": {
        "command": "npx",
        "args": ["tsx", "<project-root>/src/mcp/index.ts"]
      }
    }
  }
  ```

## Data Storage

**Database:**
- SQLite via Prisma ORM
- Connection: `DATABASE_URL` env var
- Schema: `prisma/schema.prisma`
- Database file: `prisma/dev.db` (local file)
- WAL mode enabled in MCP server (`PRAGMA journal_mode=WAL` in `src/mcp/db.ts`)
- Two PrismaClient instances:
  - Next.js app: `src/lib/db.ts` (singleton pattern with `globalThis` caching)
  - MCP server: `src/mcp/db.ts` (standalone instance for stdio process)

**File Storage:**
- Local filesystem only
- No cloud storage integration

**Caching:**
- None (no Redis, Memcached, or similar)

## Authentication & Identity

**Auth Provider:**
- None. No user authentication system.
- The application is a local-first tool without user accounts or login.

## Monitoring & Observability

**Error Tracking:**
- None (no Sentry, Datadog, or similar)

**Logs:**
- `console.error` for MCP server startup failures (`src/mcp/index.ts`)
- Prisma query logging in development mode (`src/lib/db.ts`: `log: ["query"]` when `NODE_ENV === "development"`)
- Claude adapter streams stdout/stderr via `onLog` callback

## CI/CD & Deployment

**Hosting:**
- Not configured. Local development tool.

**CI Pipeline:**
- Not detected (no `.github/workflows/`, no CI config files)

## Environment Configuration

**Required env vars:**
- `DATABASE_URL` - SQLite connection string (e.g., `file:./dev.db`)

**Optional env vars:**
- `NODE_ENV` - Controls Prisma query logging (`development` enables query logs)

**Env files present:**
- `.env` - Active environment variables (DO NOT read)
- `.env.local` - Local overrides (DO NOT read)
- `.env.example` - Template showing `DATABASE_URL` pointing to PostgreSQL (note: actual schema uses SQLite, the example is outdated)

**Note:** The `.env.example` shows a PostgreSQL URL (`postgresql://postgres:postgres@localhost:5432/ai_manager`) but the Prisma schema (`prisma/schema.prisma`) is configured for SQLite. This is a discrepancy -- the example file does not match the actual database provider.

## Webhooks & Callbacks

**Incoming:**
- None

**Outgoing:**
- None

## Adapter System

The project uses an adapter pattern for AI agent execution, allowing pluggable backends:

**Registry:** `src/lib/adapters/registry.ts`
- `getAdapter(type)` - Returns adapter by type string
- `listAdapters()` - Lists registered adapter types

**Interface:** `src/lib/adapters/types.ts`
- `AdapterModule` interface: `execute(ctx)` and `testEnvironment(cwd)`
- `ExecutionContext`: prompt, cwd, model, sessionId, timeout, env, onLog callback
- `ExecutionResult`: exitCode, signal, timedOut, summary, usage stats, cost

**Registered Adapters:**
- `claude-local` (`src/lib/adapters/claude-local/`) - Spawns local Claude CLI process
  - `execute.ts` - Core execution logic with session retry
  - `parse.ts` - Parses Claude stream-json output
  - `test.ts` - Environment validation (checks Claude CLI availability)
  - `index.ts` - Module entry point

## Internationalization

**Custom i18n:**
- Implementation: `src/lib/i18n.tsx` (React Context-based, no external library)
- Locales: `zh` (Chinese), `en` (English)
- Default: Chinese (`lang="zh-CN"` in root layout)
- All translations inline in the i18n file (no separate translation files)

---

*Integration audit: 2026-03-26*
