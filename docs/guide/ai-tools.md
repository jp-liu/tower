---
title: AI Tools 0.3
description: 连接、能力插槽、Assistant 与 CLI 插件使用指南
---

## 心智模型

打开「设置 -> AI Tools」后，先在页面上半区建立**连接**，再在下半区把连接分配给 **Terminal、Summary、Dreaming、Analysis、Assistant**。连接回答“Tower 能访问哪些 AI”，插槽回答“这个功能按什么顺序用哪个连接和模型”。同一连接可供多个插槽使用。

## CLI 连接

Tower 内置 Claude Code、Codex CLI 和 Gemini CLI。每张连接卡依次展示命令发现路径、版本、Hello 测试、可用模型，以及 MCP/Hooks/Skills 的支持和安装状态。状态可能是未找到、已找到但不可运行、未登录/未连接、已连接。

Tower 不接管 CLI 的账户：请先按各 CLI 自己的方式完成登录、token、代理和 base URL 配置。Tower 的高级环境变量只是兼容入口，不会代替 CLI 登录。Hello 测试必须得到最小模型回复；仅 `--version` 成功不算已连接。

## API 连接

支持 OpenAI、OpenAI Compatible、Anthropic 和 Google。一个协议可以创建多个命名连接，例如公司网关与个人账户。

- base URL 必须是完整的 `http://` 或 `https://` 地址。Tower 只 trim 并去掉末尾 `/`，**不会自动补 `/v1`**。
- 可添加、启停自定义 header/query；传输层 header 被禁止，敏感名称的值默认掩码。
- 每个连接可保存多个 Key，逐 Key 用默认模型执行最小健康检查。运行时仅在启用且测试成功的 Key 中 round-robin。
- 在尚未产生内容/工具副作用前，`401`、`403`、`429` 可尝试下一个健康 Key；流已开始后不换 Key。
- 模型列表采用自动发现加手动补充。刷新不会删除手动模型；上游消失但仍被引用的模型标为 unavailable。

API Key 以明文存入本机 SQLite。界面默认掩码，但本机用户可以显示、复制和编辑。Key、敏感 header/query 随数据库进入完整备份；普通日志、错误、任务消息和测试报告不会记录完整值。

## 五个能力插槽

每个插槽保存主目标与用户显式排序的备用目标，目标是稳定的 `connection + model`。Tower 不会挑选“第一个可用 Provider”。

- Terminal：仅 CLI。新会话启动前可因缺失/探测/启动失败回退；会话建立后固定 connection/model，Resume 不切换。
- Summary：失败后保留确定性的 Git/提交摘要。
- Dreaming：失败时跳过，可稍后重试。
- Analysis：失败时保留原项目描述。
- Assistant：当前轮首个流式内容或工具调用前可回退，之后锁定；失败显示在本轮。

取消、内容安全拒绝、配置错误和工具执行错误不触发跨连接回退。

## Assistant

Assistant 使用 Tower 自有多轮会话，支持 workspace/project/version 绑定、图片和文本附件、SSE 流式输出、Tower 工具卡以及取消。旧 Claude Assistant 会话仍会出现在列表中，第一次打开时按需复制导入；原 transcript 不会被自动删除或改写。导入后可以用其他已配置 Provider 继续对话。

## 第三方 CLI 插件

在「CLI 插件」中输入 npm 包名和**精确版本**，或选择本地开发目录。Tower 先下载/读取并校验完整性、Manifest、入口、Schema 和权限，不执行 npm install script。插件默认禁用；确认权限后才安装并启用。之后可编辑连接名称、命令、参数、环境和插件 Schema 配置，也可禁用、重新启用或卸载。

本地开发模式直接引用绝对目录，适合迭代；目录损坏或入口变化会显示插件损坏。插件是本地可信 Node.js 代码，不是操作系统沙箱，只安装你信任的包。

## 常见诊断

| 状态/错误 | 处理 |
|---|---|
| CLI 未安装/未找到 | 安装 CLI、修正命令覆盖或选择绝对路径，再重新检测 |
| CLI 未登录 | 在 CLI 自己的终端完成登录/token/base URL，然后重跑 Hello |
| MCP 未连接 | 检查 MCP 状态并重新安装/修复；CLI 已安装不代表 MCP 已连上 |
| API `401`/`403` | 检查 Key、权限、header 覆盖和 base URL 协议 |
| API `429` | 检查额度/限流；健康多 Key 可在首活动前轮换 |
| `model unavailable` | 刷新模型或手动填写准确 model ID，再更新插槽目标 |
| 插件损坏 | 检查安装完整性/本地目录，重新安装或恢复 registry |
| 权限待确认 | 审阅权限清单并显式确认；未确认时插件不会加载 |
| `slot unconfigured` | 给对应插槽添加至少一个已启用、已连接的目标 |

完整升级和备份边界见 [升级到 0.3.0](/guide/upgrade-0.3)。
