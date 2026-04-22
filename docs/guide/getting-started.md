---
title: 快速开始
description: 安装和运行 Tower 项目的步骤
---

## 前置条件

- **Node.js** >= 22
- **pnpm**（包管理器）

## 安装步骤

### 1. 克隆仓库

```bash
git clone <repo-url> tower
cd tower
```

### 2. 安装依赖

```bash
pnpm install
```

### 3. 配置环境变量

```bash
cp .env.example .env
```

根据需要编辑 `.env` 文件，主要配置 `DATABASE_URL`（SQLite 数据库路径）。

### 4. 初始化数据库

```bash
# 同步 Prisma schema 到数据库
pnpm db:push

# 导入种子数据
pnpm db:seed

# 创建全文搜索索引
pnpm db:init-fts
```

### 5. 启动开发服务器

```bash
pnpm dev
```

打开浏览器访问 [http://localhost:3000](http://localhost:3000)。

## MCP 集成

如需将 Tower 的工具能力暴露给外部 AI Agent，在 MCP 客户端配置中添加：

```json
{
  "mcpServers": {
    "tower": {
      "command": "npx",
      "args": ["tsx", "<project-root>/src/mcp/index.ts"]
    }
  }
}
```

将 `<project-root>` 替换为项目的绝对路径。

## 常用命令

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 启动开发服务器（Webpack 模式，node-pty 需要） |
| `pnpm db:push` | 同步 Prisma schema |
| `pnpm db:seed` | 导入种子数据 |
| `pnpm db:init-fts` | 创建全文搜索索引 |
| `pnpm test:run` | 运行测试 |
