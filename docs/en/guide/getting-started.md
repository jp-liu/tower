---
title: Getting Started
description: Steps to install and run the Tower project
---

## Prerequisites

- **Node.js** >= 22
- **pnpm** (package manager)

## Installation

### 1. Clone the Repository

```bash
git clone <repo-url> tower
cd tower
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Configure Environment Variables

```bash
cp .env.example .env
```

Edit the `.env` file as needed. The main configuration is `DATABASE_URL` (SQLite database path).

### 4. Initialize the Database

```bash
# Sync Prisma schema to the database
pnpm db:push

# Import seed data
pnpm db:seed

# Create full-text search index
pnpm db:init-fts
```

### 5. Start the Development Server

```bash
pnpm dev
```

Open your browser and visit [http://localhost:3000](http://localhost:3000).

## MCP Integration

To expose Tower's tool capabilities to external AI agents, add the following to your MCP client configuration:

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

Replace `<project-root>` with the absolute path to the project.

## Common Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start development server (Webpack mode, required for node-pty) |
| `pnpm db:push` | Sync Prisma schema |
| `pnpm db:seed` | Import seed data |
| `pnpm db:init-fts` | Create full-text search index |
| `pnpm test:run` | Run tests |
