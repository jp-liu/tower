# AI Manager

AI 任务管理平台 — 看板 + 终端 + 代码编辑器 + MCP 工具链。

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
- 数据库：SQLite 单文件，Prisma ORM，配置在 `.env` 的 `DATABASE_URL`
