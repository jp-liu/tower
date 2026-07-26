---
title: CLI Provider 开发
description: "@tower-org/ai-sdk Manifest v1、Adapter、Schema 与信任边界"
---

## 发布状态

`packages/ai-sdk` 定义公共 CLI Provider 契约 v1，但 0.3.0 中仍为 `private@0.1.0` workspace 包。`ai-runtime` 和三个官方 Provider 同样 private；本期没有创建 GitHub Organization/npm scope，也没有发布独立包。外部正式依赖需等待后续发布；仓库内或本地开发可引用源码，并应把运行时 SDK 依赖打入插件产物。

## 最小包结构

```json
{
  "name": "@example/tower-provider-acme",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    "./tower-cli-provider": "./dist/provider.js"
  },
  "files": ["dist", "config.schema.json"],
  "tower": {
    "manifestVersion": 1,
    "apiVersion": "1.0",
    "kind": "cli-provider",
    "display": { "name": "Acme CLI", "description": "Acme CLI for Tower" },
    "command": {
      "default": "acme",
      "aliases": ["acme-cli"],
      "knownPaths": { "darwin": ["~/.local/bin/acme"], "linux": ["~/.local/bin/acme"] },
      "versionArgs": ["--version"]
    },
    "compatibility": { "tower": ">=0.3.0 <0.4.0", "node": ">=20" },
    "capabilities": {
      "sessions": { "fresh": true, "resume": true },
      "query": { "generate": true, "stream": true },
      "models": true,
      "integrations": { "mcp": true, "hooks": false, "skills": true }
    },
    "permissions": ["process:spawn", "network:provider", "integration:mcp", "integration:skills"],
    "configSchema": "./config.schema.json"
  }
}
```

Tower 在加载插件代码前校验 `package.json#tower`、Catalog 版本、Tower/Node 兼容范围、CLI 依赖、权限、入口和 Schema。一个包在 v1 只提供一个 CLI Provider；Manifest `id` 是全局扩展 ID，命名导出固定为 `towerCliPlugin`。

## Adapter

```ts
import packageJson from "../package.json" with { type: "json" };
import {
  BaseCliAdapter,
  defineCliPlugin,
  type CliPluginManifestV1,
} from "@tower-org/ai-sdk";

const manifest = packageJson.tower as CliPluginManifestV1;

class AcmeAdapter extends BaseCliAdapter {
  buildSessionProcess(options) {
    return {
      command: "acme",
      args: ["chat", ...(options.model ? ["--model", options.model] : [])],
      cwd: options.cwd,
      envPatch: options.envPatch,
      initialInput: options.prompt,
    };
  }

  async generate(options) {
    return { text: `reply to ${options.prompt}`, finishReason: "stop" };
  }

  async models() { return [{ id: "acme-default", displayName: "Acme Default" }]; }
}

export const towerCliPlugin = defineCliPlugin({
  manifest,
  createAdapter: (host, _settings) => new AcmeAdapter(host),
});
```

实际 `BaseCliAdapter` 的默认 `stream()` 会把 `generate()` 结果转为规范事件；Provider 也可以反向以流为真源并用 `collectCliQueryStream()` 聚合。`CliQueryEvent` 包括 `text`、`reasoning`、`tool-call`、`tool-result`、`usage`、`session`、`finish`、`error`。错误码要规范化，且不得包含 token、完整命令环境或敏感输出。

Terminal process spec 必须是结构化 `command + args + cwd + envPatch + initialInput`，不能返回 shell 字符串。宿主负责命令发现、PTY、超时、AbortSignal、进程树回收和状态；Adapter 不得自行修改 `process.env`。模型接口返回 ID/显示名；MCP、Hooks、Skills 是各自独立的可选 `inspect/install/uninstall` 子接口。

## JSON Schema

配置文件使用 JSON Schema 2020-12。Tower 支持 `x-tower` 的 `control`、`order`、`group`、`advanced`、`sensitive`；插件不能注入 React 或设置页脚本。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "profile": {
      "type": "string",
      "title": "Profile",
      "default": "default",
      "x-tower": { "control": "text", "order": 1, "group": "CLI" }
    },
    "accessToken": {
      "type": "string",
      "x-tower": { "control": "text", "order": 2, "group": "Advanced", "advanced": true, "sensitive": true }
    }
  }
}
```

Connection 名称、启用状态、命令覆盖、基础参数和高级环境变量由 Host 统一管理。插件 Schema 只描述插件 `settings`；secret 必须标记 `sensitive`，不得进入日志、错误、Manifest 或注册表摘要。

## Catalog 贡献与构建

当前仓库保留了可整体迁移到独立扩展仓库的源码布局：

```text
extensions/
  cli-providers/<provider>/     # Provider 源码、Manifest、Schema、测试
  catalog/sources/*.json        # 可审查的扩展与版本声明
  catalog/schema/*.json         # 源码和生成索引 Schema
scripts/build-extension-catalog.ts
```

贡献一个版本时：

1. 只依赖 `@tower-org/ai-sdk` 和 Host Context，实现 Provider 并运行自身 typecheck/test/build。
2. 在 `extensions/catalog/sources/` 添加或更新声明；`id`、Publisher 和版本必须与包 Manifest 一致。
3. 运行 `pnpm extensions:catalog:build -- --base-url https://<authorized-host>/<path>/ --output <directory>`。基础 URL 必须由获授权的发布流程传入，仓库不预设组织、域名或发布地址。
4. 生成器校验源码 Schema 和 Runtime index Schema，将预构建 `dist` 与配置 Schema 打包；Artifact 会移除 scripts、dependencies 和 devDependencies，使用稳定排序/mtime，生成 SHA-256、大小和 `index.v1.json`。
5. 在临时 HTTPS/fake fetch 环境验证索引与 Artifact，再由后续获授权的发布流程上传。不要提交凭据，也不要在贡献流程访问真实 Provider 账号。

Tower 服务端从 `TOWER_EXTENSION_CATALOG_URL` 读取 index URL；数据库系统配置 `extensions.catalogUrl` 是无环境覆盖时的备用值。不得让浏览器提交 Catalog URL、Artifact URL 或本地路径。运行时继续强制 HTTPS、响应大小、SHA-256、归档安全和原子安装限制。

本地调试不需要 Catalog：构建 Provider 后，在「设置 -> 扩展 -> 开发者模式」注册其绝对目录。它会标记为 `development`，源码原地引用，不复制到扩展安装区。

## Qwen Code 样板

`extensions/cli-providers/qwen-code` 是不进入静态 `ProviderRegistry` 的社区样板。它用 `qwen --version` 探测 `>=0.18.0 <1.0.0`，Terminal 会话使用 Qwen 交互 CLI，query 使用官方 headless `--prompt` 与 `--output-format json/stream-json` 参数，并支持 `--resume`、`--continue`、`--model` 和 `--max-session-turns` 对应的契约能力。

该扩展只声明 `process:spawn` 和 `network:provider`，且只声明实际实现的 Terminal/query 能力。Tower 不安装 `@qwen-code/qwen-code`，不配置 Qwen base URL/token，不执行登录，也不改写 `~/.qwen`；Qwen Code CLI 及其账号状态完全由用户和 Qwen 工具负责。

## 信任与安装边界

- 正常安装只接受 Catalog 中的精确版本和不可变 Artifact；npm Runtime 仅为旧注册兼容，不在普通用户界面出现。
- Artifact 校验 HTTPS、响应/实际大小、SHA-256 和 tar 路径，拒绝 lifecycle script、依赖树、原生模块与逃逸入口。
- 插件默认禁用，权限确认后按需加载；权限变化必须重新确认。更新先 staging 验证后原子切换，失败保留旧版本。
- Host Context 只提供受控进程、插件存储、平台、脱敏日志和取消信号，不提供 Prisma、其他连接或 API Key。
- `process:spawn`、provider config、network、MCP/Hooks/Skills 均需 Manifest 权限；声明不等于操作系统沙箱。

契约源码以 `packages/ai-sdk/src/manifest.ts`、`adapter.ts`、`process.ts`、`config-schema.ts` 为准。
