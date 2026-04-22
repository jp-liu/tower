---
title: Settings 模块
description: 系统配置管理，包括通用配置、AI 工具配置、CLI Profile 管理
---

**Slug:** `settings`

## 功能介绍

系统设置分为多个配置区域，管理 Tower 的全局行为和 AI 执行参数。

### 配置区域

- **通用配置**：主题切换（暗色 / 亮色 / 跟随系统）、语言切换（中文 / 英文）、默认终端应用
- **终端配置**：WebSocket 端口设置、空闲超时时间
- **系统配置**：上传文件大小限制、最大并发执行数、Git 操作超时时间、搜索参数
- **CLI Profile**：配置 AI CLI 的命令（如 `claude`）、启动参数、环境变量。CLI Profile 影响所有任务执行时使用的 CLI 命令，仅允许一个默认配置
- **Prompt 模板**：自定义 AI 提示词模板，可以按工作区隔离。任务执行时可以选择使用哪个 Prompt 模板
- **Agent 配置**：管理 AI 代理的附加 prompt 和设置，每个 Agent 配置有唯一的 `(agent, configName)` 约束
- **Git 路径映射**：配置 host/owner 到本地路径的映射规则，自动解析 Git URL 对应的本地目录

## 详细说明

### CLI Profile

CLI Profile 控制 PTY 终端使用的 CLI 命令和参数：
- `command`: CLI 命令（默认 `claude`），仅允许 `claude` / `claude-code`
- `baseArgs`: JSON 字符串数组，传给 CLI 的启动参数
- `envVars`: JSON 对象，注入到 PTY 环境变量
- `isDefault`: 仅允许一个默认配置

### Agent 配置

Agent 配置管理 AI 代理的附加 prompt 和高级设置：
- 唯一约束: `(agent, configName)`
- 支持全局和工作区级别的 Prompt 模板

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
