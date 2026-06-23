# Tower

AI 任务调度平台 — 看板 + 终端 + 代码编辑器 + MCP 工具链。

**Tech:** Next.js 16 / TypeScript / SQLite (Prisma) / TailwindCSS 4 / shadcn (base-nova)

## Quick Reference

```bash
pnpm dev              # 启动（Webpack 模式，node-pty 需要）
pnpm db:push          # 同步 schema
pnpm db:seed          # 种子数据
pnpm db:init-fts      # 全文搜索索引
pnpm test:run         # 测试
```

## Architecture

```
Workspace → Project → Task → Execution
```

- 数据模型和 API 参考见 @AGENTS.md
- UI 规范见 `.claude/rules/ui.md`（组件尺寸、Select、Toast、Loading、i18n）
- 安全规则见 `.claude/rules/security.md`（输入校验、环境注入、API 防护）
- 进程生命周期见 `.claude/rules/process-lifecycle.md`（PTY、Preview、WS、定时器）

## Key Conventions

- 国际化：所有用户可见文本用 `t("key")`，zh/en 双语
- Next.js 15+ 异步 params：`const { id } = await params`
- App Router routes：`export const runtime = "nodejs"` + `export const dynamic = "force-dynamic"`
- 数据库：SQLite 单文件，Prisma ORM。**DB 位置由数据根目录派生**（`getTowerDbPath()`），不读 `DATABASE_URL` env
- 数据根目录（dev/prod 隔离）：
  - 运行时一律走 `getTowerDir()`/`getStorageDir()`（`src/lib/tower-dir.ts`），DB 与存储同根，永不分家
  - 环境选择**不放进 `.env`**（Prisma 运行时会自动加载 `.env` 并串进所有进程，含 MCP）：dev 由 `pnpm dev`/`db:*` 脚本指向 `~/.tower-dev`，prod 由 `bin/tower.mjs` pin `~/.tower`
  - MCP 进程额外有 `src/mcp/env-guard.ts` 在 Prisma 加载前兜底 pin `TOWER_DATA_DIR`
  - 构建产物隔离：dev 用 `.next-dev`（`NEXT_DISTDIR`），prod 用 `.next`
