# Settings 模块

**Slug:** `settings`

## 概述

系统配置管理，包括通用配置、AI 工具配置、CLI Profile 管理。

## 文件清单

### 页面

| 路由 | 说明 |
|------|------|
| `/settings` | 设置主页面 |

### 组件 (`src/components/settings/`)

| 组件 | 说明 |
|------|------|
| `general-config.tsx` | 通用配置 |
| `system-config.tsx` | 系统配置 |
| `ai-tools-config.tsx` | AI 工具配置 |
| `cli-profile-config.tsx` | CLI Profile 管理 |

### Server Actions

| 文件 | 说明 |
|------|------|
| `config-actions.ts` | 系统配置读写 |
| `agent-config-actions.ts` | Agent 配置管理 |
| `cli-profile-actions.ts` | CLI Profile CRUD |

### 数据模型

**CliProfile**: 控制 PTY 使用的 CLI 命令和参数
- `command`: CLI 命令（默认 `claude`）
- `baseArgs`: JSON 字符串数组
- `envVars`: JSON 对象
- `isDefault`: 仅允许一个默认配置

**AgentConfig**: Agent 特定配置
- 唯一约束: `(agent, configName)`
