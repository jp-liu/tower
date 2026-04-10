# Technology Stack

**Analysis Date:** 2026-03-26

## Languages

**Primary:**
- TypeScript ^5 - All application code (frontend, backend, MCP server)

**Secondary:**
- SQL (SQLite) - Database via Prisma schema (`prisma/schema.prisma`)
- CSS (Tailwind v4) - Styling via `@tailwindcss/postcss`

## Runtime

**Environment:**
- Node.js (version not pinned; no `.nvmrc` or `.node-version` file detected)
- Next.js 16 requires Node.js 18.18+

**Package Manager:**
- pnpm (lockfile: `pnpm-lock.yaml` present)
- `pnpm.onlyBuiltDependencies` configured for `@prisma/engines`, `esbuild`, `prisma`

## Frameworks

**Core:**
- Next.js 16.2.1 - Full-stack React framework (App Router)
- React 19.2.4 / React DOM 19.2.4 - UI rendering
- Prisma 6.19.2 (`@prisma/client` + `prisma` CLI) - ORM / database access

**Testing:**
- Vitest 4.1.1 - Unit/integration test runner
- Playwright 1.58.2 - E2E browser testing
- Testing Library (React 16.3.2, jest-dom 6.9.1, user-event 14.6.1) - Component testing
- jsdom 29.0.1 - DOM environment for Vitest

**Build/Dev:**
- Turbopack - Dev server bundler (`next dev --turbopack`)
- tsx 4.21.0 - TypeScript execution for scripts and MCP server
- PostCSS with `@tailwindcss/postcss` - CSS processing
- ESLint 9 with `eslint-config-next` 16.2.1 - Linting

## Key Dependencies

**Critical:**
- `next` 16.2.1 - Application framework; uses App Router with Server Components and Server Actions
- `@prisma/client` ^6.19.2 - Database client for SQLite
- `react` 19.2.4 - UI rendering engine
- `zustand` ^5.0.12 - Client-side state management (`src/stores/board-store.ts`, `src/stores/task-execution-store.ts`)
- `zod` ^4.3.6 - Schema validation (used in MCP tool definitions and input validation)
- `@modelcontextprotocol/sdk` ^1.28.0 - MCP server implementation

**UI:**
- `@base-ui/react` ^1.3.0 - Headless UI primitives
- `shadcn` ^4.1.0 - Component library scaffolding (`src/components/ui/`)
- `lucide-react` ^1.6.0 - Icon library
- `@dnd-kit/core` ^6.3.1, `@dnd-kit/sortable` ^10.0.0, `@dnd-kit/utilities` ^3.2.2 - Drag-and-drop for Kanban board
- `class-variance-authority` ^0.7.1 - Variant-based component styling
- `clsx` ^2.1.1 + `tailwind-merge` ^3.5.0 - Class name utilities
- `tw-animate-css` ^1.4.0 - Tailwind animation classes

**Infrastructure:**
- `conventional-changelog-cli` ^5.0.0 - Changelog generation

## Configuration

**TypeScript:**
- Config: `tsconfig.json`
- Target: ES2017, Module: ESNext, Module resolution: bundler
- Strict mode enabled
- Path alias: `@/*` maps to `./src/*`
- JSX: react-jsx

**ESLint:**
- Config: `eslint.config.mjs`
- Extends: `eslint-config-next/core-web-vitals` + `eslint-config-next/typescript`

**PostCSS:**
- Config: `postcss.config.mjs`
- Plugin: `@tailwindcss/postcss` (Tailwind v4 integration)

**Vitest:**
- Config: `vitest.config.ts`
- Environment: jsdom
- Setup: `tests/setup.ts`
- Test location: `tests/**/*.test.{ts,tsx}`
- Uses `@vitejs/plugin-react` for JSX support

**Playwright:**
- Config: `playwright.config.ts`
- Test directory: `tests/e2e/`
- Base URL: `http://localhost:3000`
- Browser: Chromium only

**Database:**
- Schema: `prisma/schema.prisma`
- Provider: SQLite
- Database file: `prisma/dev.db`
- Seed script: `prisma/seed.ts` (run via `tsx`)

**Build:**
- `next.config.ts` - Minimal config (no custom settings)
- Dev uses Turbopack (`next dev --turbopack`)

## NPM Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `dev` | `next dev --turbopack` | Start dev server with Turbopack |
| `build` | `next build` | Production build |
| `start` | `next start` | Start production server |
| `lint` | `eslint` | Run linter |
| `db:generate` | `prisma generate` | Generate Prisma client |
| `db:push` | `prisma db push` | Push schema to database |
| `db:seed` | `tsx prisma/seed.ts` | Seed database |
| `db:studio` | `prisma studio` | Open Prisma Studio GUI |
| `test` | `vitest` | Run tests in watch mode |
| `test:run` | `vitest run` | Run tests once |
| `mcp` | `tsx src/mcp/index.ts` | Start MCP server |

## Platform Requirements

**Development:**
- Node.js 18.18+ (Next.js 16 requirement)
- pnpm installed globally
- SQLite (bundled via Prisma, no external install needed)
- Claude CLI (`claude` binary) for task execution adapter

**Production:**
- Node.js 18.18+
- SQLite-compatible filesystem (writable for `prisma/dev.db`)
- No external database server required

---

*Stack analysis: 2026-03-26*
