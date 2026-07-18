---
title: Tower Agent 能力扩展
description: 如何通过专用 operator agent 扩展 o-tower 的飞书、邮件、知识库等外部系统能力
---

**Slug:** `agent-extension`

## 设计原则

`o-tower` 是 Tower 的入口和协调者，不是万能执行者。

Tower 官方默认 profile 保持纯净：只安装 Tower MCP 和 `tower` skill，负责项目、任务、笔记、无人值守消息登记与回灌。飞书、邮件、Slack、Notion、企业知识库等第三方能力由用户或团队在本地网关中配置专用 operator agent，再让 `o-tower` 按能力路由委托。

推荐分工：

| 角色 | 直接能力 | 职责 |
|------|----------|------|
| `o-tower` | Tower MCP + `tower` skill | 接收入口消息、判断意图、创建/更新 Tower 任务、把外部系统请求委托出去、汇总结果 |
| `xiao-fei` 等 operator | 飞书或其他外部系统 MCP/skills | 执行用户有权访问的公司文档空间操作，例如文档页面、知识库页面、普通表格、多维表格、云盘文件、附件、权限检查 |
| Tower | 任务与协作状态 | 记录需求、进展、问题、回复，不持有第三方系统密钥 |

这个边界让 Tower 的默认安装对所有用户都可用，也避免把某个团队的飞书、邮件或知识库配置塞进全局 `o-tower` 本体。

## 能力路由

把能力当成可路由的命名空间，而不是把所有工具装给同一个 agent。

示例：

```yaml
capabilityRoutes:
  tower.task: o-tower
  tower.project: o-tower
  tower.note: o-tower
  feishu.docs: xiao-fei
  feishu.wiki: xiao-fei
  feishu.sheets: xiao-fei
  feishu.bitable: xiao-fei
  feishu.drive: xiao-fei
  feishu.permissions: xiao-fei
  mail.read: mail-operator
  mail.send: mail-operator
```

`o-tower` 看到 Tower 范围内的需求时自己处理；看到飞书文档页面、知识库页面、普通表格、多维表格、云盘文件、附件、权限等请求时，把目标、输入、期望输出和风险约束交给 `xiao-fei`。`xiao-fei` 返回结构化结果后，`o-tower` 再回复用户或写回 Tower。

## OpenClaw 示例：小飞负责飞书

先创建专用 agent workspace：

```bash
openclaw agents add xiao-fei \
  --workspace ~/.openclaw/workspaces/xiao-fei \
  --agent-dir ~/.openclaw/agents/xiao-fei/agent \
  --non-interactive
openclaw agents set-identity --agent xiao-fei --name 小飞
```

安装和配置飞书 MCP/skills 时只给 `xiao-fei` 使用。`o-tower` 保持 Tower-only。这里的小飞不是表格专员，而是飞书工作空间 operator：它负责你有权限访问的公司文档、知识库页面、普通表格、多维表格、云盘文件、附件和权限检查。

`~/.openclaw/openclaw.json` 中收窄 allowlist：

```json
{
  "agents": {
    "list": [
      {
        "id": "o-tower",
        "skills": ["tower"],
        "allowedTools": ["tower__*"]
      },
      {
        "id": "xiao-fei",
        "skills": ["feishu"],
        "allowedTools": ["feishu__*"]
      }
    ]
  }
}
```

如果使用本地统一 Feishu MCP facade，可以把官方 Lark MCP 与普通 Sheets values 工具合并到一个 `feishu` MCP server，对外暴露同一 `feishu__...` namespace。例如普通飞书表格补充工具可命名为：

- `feishu__sheets_values_resolve`
- `feishu__sheets_values_read`
- `feishu__sheets_values_update`
- `feishu__sheets_values_append`

## 路由文件

在 `o-tower` workspace 放一份本地路由表，例如：

```text
~/.openclaw/workspaces/o-tower/delegation-routes.json
```

可参考 Tower 扩展包内的：

```text
extensions/tower-agent/examples/openclaw-local-delegation-routes.json
```

最小示例：

```json
{
  "schemaVersion": 1,
  "sourceAgent": "o-tower",
  "defaultPolicy": {
    "directCapabilities": ["tower"],
    "delegateExternalCapabilities": true,
    "noDefaultThirdPartyIntegration": true
  },
  "routes": [
    {
      "id": "feishu-sheets",
      "capabilities": ["feishu.sheets", "feishu.bitable"],
      "match": ["飞书表格", "飞书多维表格", "Bitable", "Base"],
      "agent": "xiao-fei",
      "delegateCommand": "openclaw agent --agent xiao-fei --json --message-file <task-file>",
      "requiresConfirmationForWrite": true
    },
    {
      "id": "feishu-docs-wiki-drive",
      "capabilities": ["feishu.docs", "feishu.wiki", "feishu.drive", "feishu.permissions"],
      "match": ["飞书文档", "飞书云文档", "飞书知识库", "飞书 wiki", "飞书文件", "飞书附件", "云盘", "文件夹"],
      "agent": "xiao-fei",
      "delegateCommand": "openclaw agent --agent xiao-fei --json --message-file <task-file>",
      "requiresConfirmationForWrite": true
    }
  ]
}
```

然后在 `~/.openclaw/workspaces/o-tower/USER.md` 或 profile rules 中加入委托意识：

```text
你直接操作 Tower。遇到飞书文档页面、知识库页面、普通表格、多维表格、云盘文件、附件、权限请求时，按
delegation-routes.json 委托给 xiao-fei。委托时写清目标、输入链接/表名/range、
期望输出、是否只读、写入风险。写入、删除、批量修改、权限变更默认先给用户确认计划。
面向用户回复时使用“文档页面”“知识库页面”“表格”“多维表格”等业务词，不要暴露 DocX、obj_type、MCP namespace、token、临时文件路径或底层命令。
```

## 委托消息格式

给 operator agent 的任务建议固定为结构化文本，减少来回追问：

```yaml
goal: "读取飞书表格并汇总班级权限规则"
capability: "feishu.sheets"
inputs:
  links:
    - "<用户提供的飞书链接>"
  sheetName: "V2.0分班系统"
  range: "A1:K120"
mode: "read-only"
expectedOutput:
  ok: true
  summary: "面向用户的简短结论"
  evidence: "用表名、字段名、行号描述依据，不泄露 token"
  actionsTaken: []
  risks: []
constraints:
  - "不要输出 app secret、access token、refresh token"
  - "写入或权限变更前必须先返回计划等待确认"
```

## 用户自定义选择

高级用户可以把飞书 MCP/skills 直接装进自己的 `o-tower`，让它直接操作飞书。这是个人环境选择，不是 Tower 官方默认 profile 的推荐路径。

官方默认保持纯净的原因：

- 第三方系统权限属于用户或团队，不应被 Tower 默认安装隐式持有。
- 不同公司对飞书、邮件、知识库的权限、审批和审计要求不同。
- 专用 operator 更容易做最小权限、单一 token owner、审计和替换。
- 多个 MCP 进程同时刷新同一 user token 容易产生竞争，专用 owner 更稳。

## 风险和边界

- 不要在文档、prompt、路由表中写入 app secret、access token、refresh token。
- 飞书文档/表格如果要按“用户能操作，agent 才能操作”的同权方式运行，应走 `user_access_token`，并由一个 MCP owner 管理刷新。
- 本地化飞书 OAuth 登录默认不要手动传 `--scope`；未申请、未发布或未生效的权限可能触发 `20027 AppDidNotApplyForPermissions`。
- 飞书 wiki URL 即使带 `sheet=...`，也必须先解析真实对象类型；真实对象是文档页面时就按文档页面读取，不要硬当表格读。
- 写入、删除、批量修改、权限变更、对外发送邮件/消息等动作默认先返回计划，等用户明确确认。
- 修改 OpenClaw agent/MCP 配置后，重启或 reload gateway。
- Tower 不默认集成飞书给所有用户；Tower 只提供扩展模式和委托规则。
