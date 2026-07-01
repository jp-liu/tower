# Harness 无人值守 · Phase 1(ask_human 闭环)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让任务在「无人值守」模式下能主动向人发问、挂起省资源、人在飞书回复后自动 resume 续跑,形成 L2 监督式自治的最小闭环。

**Architecture:** Agent 调用新的 `ask_human` MCP 工具 → Tower 记一条 `HumanInputRequest(PENDING)` 并把 execution 置 `PAUSED`(利用现有 onExit guard 跳过总结/IN_REVIEW,保留 sessionId)→ 通过统一的 `NotifyChannel` 出口把问题推到飞书(第一个 adapter)→ 人回复经飞书 bot 转发到 Tower 唯一入站路由 `/api/internal/harness/reply` → Tower 用现有 `continueOrStartTaskExecution` resume 会话并把答案注入终端。出口是**平台无关契约**,飞书只是第一个实现,OpenClaw/Hermes 后续各加一个 adapter,harness 逻辑零改动。

**Tech Stack:** Next.js 16 App Router、TypeScript、Prisma/SQLite、Zod、MCP(`@modelcontextprotocol/sdk`)、飞书 lark node-sdk(`@larksuiteoapi/node-sdk`,复用 `~/.feishu-mcp/node_modules`)。

**范围说明:** 本 plan 只做 **Phase 1**(ask_human 闭环)。Reviewer 验证闸(Phase 2)、cron/webhook 触发(Phase 3)另立 plan。本 plan 的 Tower 侧(Task 1–7)可独立单测/`curl` 验证;飞书 bot 侧(Task 8)在 `~/assistant` 仓库,是端到端集成。

**关键既有资产(不要重复造):**
- 进程退出 finalize guard:`src/actions/agent-actions.ts` 两处 onExit 都有 `if (currentExec?.status !== "RUNNING") return;` —— park 前置 `PAUSED` 即可安全跳过 finalize。
- resume 原语:`continueOrStartTaskExecution(taskId)`(`src/actions/agent-actions.ts:434`),即执行历史 Continue 按钮 / `/api/internal/terminal/[taskId]/resume`。
- 注入终端:`/api/internal/terminal/[taskId]/input`(独立 CR 提交,见 `src/lib/pty/terminal-submit.ts`)。
- PTY 生命周期:`getSession` / `destroySession`(`src/lib/pty/session-store.ts`);`destroySession` 只 killTree,不 finalize。
- Stop hook fan-out:`src/app/api/internal/hooks/stop/route.ts`(每回合结束触发,现做 `broadcastNotification` + `notifyParentOnChildStop`)。
- MCP 工具注册:`src/mcp/server.ts` 遍历 `allTools`,每个 tool = `{ description, schema(zod), handler }`。
- 内部路由防护:`requireLocalhost` + `validateTaskId`(`src/lib/internal-api-guard.ts`),CUID 正则 `/^c[a-z0-9]{20,30}$/`。

**⚠️ DB 迁移坑(必读):** 本项目 `pnpm db:push` 会被 `notes_fts` 虚表卡死(见记忆 `project_db_push_fts5_gotcha`)。**加性 schema 变更用原生 SQL(`ALTER TABLE` / `CREATE TABLE`)+ `prisma generate`,不要跑 `db:push`。** dev 库在 `~/.tower-dev/database/tower.db`。

---

## File Structure

**新建(Tower 侧):**
- `src/lib/harness/notify/types.ts` — `NotifyChannel` 接口 + `OutboundMessage` 类型(出口契约)
- `src/lib/harness/notify/feishu-channel.ts` — 飞书 adapter(lark SDK 发消息)
- `src/lib/harness/notify/registry.ts` — 渠道注册表 + `dispatchNotification(taskId, msg)`
- `src/lib/harness/human-input.ts` — `createHumanInputRequest` / `answerHumanInputRequest` / `getPendingRequest` / `parkExecutionForInput`
- `src/mcp/tools/harness-tools.ts` — `ask_human` MCP 工具
- `src/app/api/internal/harness/reply/route.ts` — 唯一入站回复路由
- `src/lib/harness/__tests__/human-input.test.ts`、`notify-registry.test.ts` — 单测

**修改(Tower 侧):**
- `prisma/schema.prisma` — `Task` 加 `unattended`/`notifyChannel`/`notifyTarget`;新增 `HumanInputRequest` 模型
- `src/mcp/server.ts` — 注册 `harnessTools`
- `src/mcp/tools/task-tools.ts` — `create_task` 接受可选 `notify` 绑定并写入 Task
- `src/app/api/internal/hooks/stop/route.ts` — 分叉:有 PENDING 请求 → park(destroySession)并跳过 notifyParent
- `src/actions/agent-actions.ts` — `startPtyExecution` 注入 `TOWER_UNATTENDED` env
- `src/lib/config-defaults.ts` — 加 harness 飞书凭据配置键(appId/appSecret/domain)

**修改(飞书 bot 侧,`~/assistant` 独立仓库):**
- `runtime/bot.js` — 回复分流:命中「绑定线程 + 该任务有 PENDING 请求」→ POST Tower `/reply`,否则老流程;建任务时把来源绑定传给 Tower

---

## Task 1: DB schema — unattended 开关、通知绑定、HumanInputRequest 模型

**Files:**
- Modify: `prisma/schema.prisma`(`model Task` ~75–107;文件末尾加新 model)
- Migrate: 原生 SQL 到 `~/.tower-dev/database/tower.db`

- [ ] **Step 1: 在 `model Task` 加字段**

```prisma
  // 无人值守:开启后 ask_human 会主动推通知;关闭则只在 UI 内显示等待,不打扰
  unattended    Boolean   @default(false)
  // ask_human 通知回流绑定:渠道 id(如 "feishu")+ 目标地址(JSON 字符串,如 {"chatId":"oc_..","threadId":"om_.."})
  notifyChannel String?
  notifyTarget  String?
```

- [ ] **Step 2: 文件末尾新增模型 + 枚举**

```prisma
model HumanInputRequest {
  id          String   @id @default(cuid())
  taskId      String
  executionId String?
  question    String
  status      HumanInputStatus @default(PENDING)
  answer      String?
  createdAt   DateTime @default(now())
  answeredAt  DateTime?

  task Task @relation(fields: [taskId], references: [id], onDelete: Cascade)

  @@index([taskId, status])
}

enum HumanInputStatus {
  PENDING
  ANSWERED
  CANCELLED
}
```

并在 `model Task` 的关系区加 `humanInputs HumanInputRequest[]`。

- [ ] **Step 3: 原生 SQL 迁移 dev 库(不要 db:push)**

Run:
```bash
sqlite3 ~/.tower-dev/database/tower.db "
ALTER TABLE Task ADD COLUMN unattended INTEGER NOT NULL DEFAULT 0;
ALTER TABLE Task ADD COLUMN notifyChannel TEXT;
ALTER TABLE Task ADD COLUMN notifyTarget TEXT;
CREATE TABLE IF NOT EXISTS HumanInputRequest (
  id TEXT PRIMARY KEY NOT NULL,
  taskId TEXT NOT NULL,
  executionId TEXT,
  question TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  answer TEXT,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  answeredAt DATETIME,
  FOREIGN KEY (taskId) REFERENCES Task(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS HumanInputRequest_taskId_status_idx ON HumanInputRequest(taskId, status);
"
```

- [ ] **Step 4: 重新生成 Prisma client**

Run: `pnpm prisma generate`
Expected: 无错误,`HumanInputRequest` 出现在生成的 client 类型里。

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(ai): harness Phase1 — Task 无人值守字段 + HumanInputRequest 模型"
```

---

## Task 2: human-input 领域库(park / 记录 / 应答)

**Files:**
- Create: `src/lib/harness/human-input.ts`
- Test: `src/lib/harness/__tests__/human-input.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { createHumanInputRequest, getPendingRequest, answerHumanInputRequest } from "../human-input";

// 用真实 dev 库或 mock;此处示范核心行为断言
describe("human-input", () => {
  it("createHumanInputRequest 落 PENDING 并把 execution 置 PAUSED", async () => {
    const { requestId, execPaused } = await createHumanInputRequest({
      taskId: TEST_TASK_ID, executionId: TEST_EXEC_ID, question: "选 A 还是 B?",
    });
    const req = await db.humanInputRequest.findUnique({ where: { id: requestId } });
    expect(req?.status).toBe("PENDING");
    expect(execPaused).toBe(true); // execution.status 已置 PAUSED
  });

  it("getPendingRequest 只返回最新的 PENDING", async () => {
    const p = await getPendingRequest(TEST_TASK_ID);
    expect(p?.status).toBe("PENDING");
  });

  it("answerHumanInputRequest 写 answer 并转 ANSWERED", async () => {
    const req = await answerHumanInputRequest(TEST_TASK_ID, "选 A");
    expect(req?.status).toBe("ANSWERED");
    expect(req?.answer).toBe("选 A");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:run src/lib/harness/__tests__/human-input.test.ts`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 实现 `human-input.ts`**

```typescript
import { db } from "@/lib/db";

export interface CreateHumanInputArgs {
  taskId: string;
  executionId?: string | null;
  question: string;
}

/**
 * 记一条待人回复的请求,并把当前 RUNNING execution 置 PAUSED。
 * PAUSED 是关键:进程被 kill 后 onExit 的 `status !== "RUNNING"` guard 会早退,
 * 不跑总结、不转 IN_REVIEW、保留 sessionId,任务可 resume。
 */
export async function createHumanInputRequest(args: CreateHumanInputArgs) {
  const req = await db.humanInputRequest.create({
    data: { taskId: args.taskId, executionId: args.executionId ?? null, question: args.question },
  });
  const paused = await db.taskExecution.updateMany({
    where: { taskId: args.taskId, status: "RUNNING" },
    data: { status: "PAUSED" },
  });
  return { requestId: req.id, execPaused: paused.count > 0 };
}

export async function getPendingRequest(taskId: string) {
  return db.humanInputRequest.findFirst({
    where: { taskId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
}

/** 收到人的回复:把最新 PENDING 请求标 ANSWERED 并写答案。无 PENDING 返回 null。 */
export async function answerHumanInputRequest(taskId: string, answer: string) {
  const pending = await getPendingRequest(taskId);
  if (!pending) return null;
  return db.humanInputRequest.update({
    where: { id: pending.id },
    data: { status: "ANSWERED", answer, answeredAt: new Date() },
  });
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test:run src/lib/harness/__tests__/human-input.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/harness/human-input.ts src/lib/harness/__tests__/human-input.test.ts
git commit -m "feat(ai): harness — human-input 领域库(park/记录/应答)"
```

---

## Task 3: 通知出口契约 + 注册表(平台无关)

**Files:**
- Create: `src/lib/harness/notify/types.ts`、`src/lib/harness/notify/registry.ts`
- Test: `src/lib/harness/__tests__/notify-registry.test.ts`

- [ ] **Step 1: 写出口契约类型 `types.ts`**

```typescript
/** harness → 人 的平台无关消息。adapter 负责渲染成飞书卡片 / OpenClaw payload。 */
export interface OutboundMessage {
  correlationId: string;               // 回流对齐用(= HumanInputRequest.id)
  taskId: string;
  kind: "ask" | "done" | "failed";
  title: string;
  body: string;
}

/** 一个发送渠道。harness 只认这个接口,不认具体平台。 */
export interface NotifyChannel {
  id: string;                                            // "feishu" | "openclaw" | ...
  send(msg: OutboundMessage, target: unknown): Promise<{ channelRef?: string }>;
}
```

- [ ] **Step 2: 写失败测试(注册表按 task.notifyChannel 路由)**

```typescript
import { describe, it, expect, vi } from "vitest";
import { registerChannel, dispatchNotification, __resetChannels } from "../notify/registry";

describe("notify registry", () => {
  it("按 task.notifyChannel 路由到对应 adapter,并透传 target", async () => {
    __resetChannels();
    const send = vi.fn().mockResolvedValue({ channelRef: "om_x" });
    registerChannel({ id: "feishu", send });
    const ok = await dispatchNotification({
      channel: "feishu", target: { chatId: "oc_1" },
      msg: { correlationId: "r1", taskId: "t1", kind: "ask", title: "问", body: "选 A?" },
    });
    expect(ok).toBe(true);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ correlationId: "r1" }), { chatId: "oc_1" });
  });

  it("渠道未注册 → 返回 false 不抛", async () => {
    __resetChannels();
    const ok = await dispatchNotification({ channel: "nope", target: {}, msg: { correlationId: "r", taskId: "t", kind: "ask", title: "", body: "" } });
    expect(ok).toBe(false);
  });
});
```

- [ ] **Step 3: 运行确认失败** — `pnpm test:run src/lib/harness/__tests__/notify-registry.test.ts` → FAIL

- [ ] **Step 4: 实现 `registry.ts`**

```typescript
import type { NotifyChannel, OutboundMessage } from "./types";
import { log } from "@/lib/log"; // 若项目 logger 路径不同,按实际调整

const channels = new Map<string, NotifyChannel>();

export function registerChannel(ch: NotifyChannel) { channels.set(ch.id, ch); }
export function __resetChannels() { channels.clear(); } // 仅测试用

export async function dispatchNotification(args: {
  channel: string; target: unknown; msg: OutboundMessage;
}): Promise<boolean> {
  const ch = channels.get(args.channel);
  if (!ch) return false;
  try { await ch.send(args.msg, args.target); return true; }
  catch (e) { log.error?.("notify dispatch failed", e as Error, { channel: args.channel }); return false; }
}
```

- [ ] **Step 5: 运行确认通过** — PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/harness/notify/types.ts src/lib/harness/notify/registry.ts src/lib/harness/__tests__/notify-registry.test.ts
git commit -m "feat(ai): harness — 通知出口契约 + 平台无关注册表"
```

---

## Task 4: 飞书 adapter(第一个渠道实现)

**Files:**
- Create: `src/lib/harness/notify/feishu-channel.ts`
- Modify: `src/lib/config-defaults.ts`(加 `harness.feishu.appId/appSecret/domain` 配置键)

- [ ] **Step 1: 配置键**

在 `config-defaults.ts` 加(值留空,由用户在设置里填或走 env `HARNESS_FEISHU_*`):
```typescript
"harness.feishu.appId": "",
"harness.feishu.appSecret": "",
"harness.feishu.domain": "https://open.xfchat.iflytek.com",
```

- [ ] **Step 2: 实现飞书 adapter**

```typescript
import type { NotifyChannel, OutboundMessage } from "./types";

// 复用飞书 MCP 已装好的 lark SDK,避免 Tower 单独装依赖
// eslint-disable-next-line @typescript-eslint/no-require-imports
const lark = require("/Users/liujunping/.feishu-mcp/node_modules/@larksuiteoapi/node-sdk");

interface FeishuTarget { chatId: string; threadId?: string; }

export function createFeishuChannel(cfg: { appId: string; appSecret: string; domain: string }): NotifyChannel {
  const client = new lark.Client({ appId: cfg.appId, appSecret: cfg.appSecret, domain: cfg.domain });
  return {
    id: "feishu",
    async send(msg: OutboundMessage, target: unknown) {
      const t = target as FeishuTarget;
      const prefix = msg.kind === "ask" ? "🙋 需要你决定" : msg.kind === "failed" ? "❌ 任务失败" : "✅ 任务完成";
      // 正文带 correlationId 兜底口令,便于人回复时对齐(飞书 bot 优先用线程绑定)
      const text = `${prefix}｜${msg.title}\n\n${msg.body}\n\n[[reply:${msg.correlationId}]]`;
      const content = JSON.stringify({ text });
      const res = await client.im.message.create({
        params: { receive_id_type: "chat_id" },
        data: { receive_id: t.chatId, msg_type: "text", content },
      });
      return { channelRef: res?.data?.message_id };
    },
  };
}
```

> 注:出站直接用 lark SDK(服务端主动发),**不走 agent 的 MCP 工具**。appId/appSecret 与 bot 的 `~/assistant/runtime/config.json` 同一套。

- [ ] **Step 3: 启动时注册渠道**

在 harness 初始化处(可放 `src/lib/harness/notify/registry.ts` 旁的 `init.ts`,或复用现有 server 启动钩子)按配置注册:
```typescript
import { getConfig } from "@/actions/config-actions";
import { registerChannel } from "./registry";
import { createFeishuChannel } from "./feishu-channel";

export async function initNotifyChannels() {
  const appId = await getConfig("harness.feishu.appId");
  const appSecret = await getConfig("harness.feishu.appSecret");
  if (appId && appSecret) {
    const domain = (await getConfig("harness.feishu.domain")) || "https://open.xfchat.iflytek.com";
    registerChannel(createFeishuChannel({ appId, appSecret, domain }));
  }
}
```
（`getConfig` 具体 API 以 `src/actions/config-actions.ts` 实际签名为准。）

- [ ] **Step 4: 手测发送**

在设置里填好凭据、群 chatId 后,用一次性脚本调 `createFeishuChannel(...).send(...)` 验证飞书群收到消息。
Expected: 飞书群出现「🙋 需要你决定…」文本。

- [ ] **Step 5: Commit**

```bash
git add src/lib/harness/notify/feishu-channel.ts src/lib/config-defaults.ts src/lib/harness/notify/init.ts
git commit -m "feat(ai): harness — 飞书通知 adapter(第一个渠道实现)"
```

---

## Task 5: `ask_human` MCP 工具

**Files:**
- Create: `src/mcp/tools/harness-tools.ts`
- Modify: `src/mcp/server.ts`(import + 并入 `allTools`)

- [ ] **Step 1: 写工具**

```typescript
import { z } from "zod";
import { db } from "../db";

const PORT = process.env.PORT ?? "3000";
const BRIDGE = `http://localhost:${PORT}/api/internal`;
const CUID_RE = /^c[a-z0-9]{20,30}$/;

export const harnessTools = {
  ask_human: {
    description:
      "Ask the human operator a question and PARK the task until they reply. " +
      "Call this ONLY when you are blocked on a decision you cannot make yourself. " +
      "This ENDS your turn — do not keep working after calling it. The task is suspended; " +
      "when the human answers, you will be resumed with their reply as the next message. " +
      "In unattended mode the question is pushed to the operator's channel (e.g. Feishu).",
    schema: z.object({
      taskId: z.string().describe("The current task id (TOWER_TASK_ID)"),
      question: z.string().min(1).max(4000).describe("The question / options for the human"),
    }),
    handler: async (args: { taskId: string; question: string }) => {
      if (!CUID_RE.test(args.taskId)) return { error: "Invalid taskId" };
      const task = await db.task.findUnique({
        where: { id: args.taskId },
        select: { id: true, title: true, unattended: true, notifyChannel: true, notifyTarget: true },
      });
      if (!task) return { error: "Task not found" };

      // 经内部桥落库 + park + 派发(桥在 Next 进程内,能访问 PTY/DB;MCP 是独立进程)
      const res = await fetch(`${BRIDGE}/harness/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId: args.taskId, question: args.question }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { error: data?.error ?? "ask failed" };
      return {
        parked: true,
        requestId: data.requestId,
        notified: data.notified,
        message:
          "Question posted. Your turn is over — stop now and wait. " +
          "You will be resumed with the human's answer.",
      };
    },
  },
};
```

> 说明:MCP 是独立 stdio 进程,拿不到 Next 内存里的 PTY/DB 会话,所以复用「内部 HTTP 桥」模式(与 `terminal-tools.ts` 一致),新增 `/harness/ask` 路由承接落库+park+派发。

- [ ] **Step 2: 新增 `/api/internal/harness/ask/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireLocalhost } from "@/lib/internal-api-guard";
import { db } from "@/lib/db";
import { createHumanInputRequest } from "@/lib/harness/human-input";
import { dispatchNotification } from "@/lib/harness/notify/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;
  const { taskId, question } = await request.json();
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { title: true, unattended: true, notifyChannel: true, notifyTarget: true,
      executions: { where: { status: "RUNNING" }, select: { id: true }, take: 1 } },
  });
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  const { requestId } = await createHumanInputRequest({
    taskId, executionId: task.executions[0]?.id ?? null, question,
  });

  let notified = false;
  if (task.unattended && task.notifyChannel && task.notifyTarget) {
    notified = await dispatchNotification({
      channel: task.notifyChannel,
      target: JSON.parse(task.notifyTarget),
      msg: { correlationId: requestId, taskId, kind: "ask", title: task.title, body: question },
    });
  }
  return NextResponse.json({ ok: true, requestId, notified });
}
```

- [ ] **Step 3: 注册工具** — `src/mcp/server.ts` 加 `import { harnessTools } from "./tools/harness-tools";` 并把 `...harnessTools` 并入 `allTools`。

- [ ] **Step 4: 冒烟**

Run: `pnpm test:run`(确保 MCP 注册不破坏既有工具测试),并手动 `curl -XPOST localhost:3000/api/internal/harness/ask -d '{"taskId":"<真实id>","question":"选A还是B"}' -H 'content-type: application/json'`
Expected: 返回 `{ok:true, requestId, notified}`;DB 有 PENDING 记录;该任务 RUNNING execution 变 PAUSED。

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools/harness-tools.ts src/mcp/server.ts "src/app/api/internal/harness/ask/route.ts"
git commit -m "feat(mcp): ask_human 工具 + /harness/ask 桥(落库+park+派发)"
```

---

## Task 6: Stop hook 分叉 —— park 时 kill PTY 且不 finalize

**Files:**
- Modify: `src/app/api/internal/hooks/stop/route.ts`

- [ ] **Step 1: 在 fan-out 前插入 park 判定**

在 `broadcastNotification(event)` 之后、`notifyParentOnChildStop` 之前:

```typescript
import { getPendingRequest } from "@/lib/harness/human-input";
import { destroySession } from "@/lib/pty/session-store";

// ... 在 broadcastNotification(event) 之后：
const pending = await getPendingRequest(task.id);
if (pending) {
  // 这次回合结束是「等人」而非「做完」：kill 掉空闲 PTY 省资源,
  // execution 已在 ask_human 时置 PAUSED → onExit guard 会跳过 finalize / IN_REVIEW,保留 sessionId。
  // 且不回推父任务(不是完成)。
  destroySession(task.id);
  return NextResponse.json({ ok: true, parked: true });
}

await notifyParentOnChildStop(task.id, task.title, lastReply ?? "");
```

- [ ] **Step 2: 验证 park 不触发 finalize**

手动:对一个 RUNNING 任务调 `/harness/ask`(置 PAUSED + PENDING)→ 让其结束一回合触发 stop hook(或直接 `curl` stop hook)→ 检查:
Run:
```bash
sqlite3 ~/.tower-dev/database/tower.db "SELECT status FROM TaskExecution WHERE taskId='<id>' ORDER BY createdAt DESC LIMIT 1;"
sqlite3 ~/.tower-dev/database/tower.db "SELECT status FROM Task WHERE id='<id>';"
```
Expected: execution 仍 `PAUSED`(非 COMPLETED/FAILED),task 仍 `IN_PROGRESS`(未被转 IN_REVIEW),PTY 会话已销毁。

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/internal/hooks/stop/route.ts"
git commit -m "feat(ai): stop hook 分叉 — 有待回复请求时 park(kill 不 finalize)"
```

---

## Task 7: 入站回复路由 —— resume 并注入答案

**Files:**
- Create: `src/app/api/internal/harness/reply/route.ts`

- [ ] **Step 1: 写路由**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireLocalhost, validateTaskId } from "@/lib/internal-api-guard";
import { answerHumanInputRequest, getPendingRequest } from "@/lib/harness/human-input";
import { continueOrStartTaskExecution } from "@/actions/agent-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PORT = process.env.PORT ?? "3000";

/**
 * 唯一入站回复出口。渠道 adapter 把人的回复归一化成 { taskId, text }(可选 correlationId)POST 到这里。
 * 流程:标 ANSWERED → resume 会话(现有 Continue 原语)→ 等会话起来后把答案注入终端。
 */
export async function POST(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;
  const { taskId, text } = await request.json();
  const idErr = validateTaskId(taskId);
  if (idErr) return idErr;
  if (!text || typeof text !== "string") {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }

  const pending = await getPendingRequest(taskId);
  if (!pending) return NextResponse.json({ error: "No pending request" }, { status: 409 });

  await answerHumanInputRequest(taskId, text);

  // resume:已有原语,already-running 为 no-op,PAUSED+sessionId → 续跑
  await continueOrStartTaskExecution(taskId);

  // 会话拉起需要一点时间;等就绪后注入答案(轮询 buffer 桥直到 session 活)
  const injected = await injectWhenReady(taskId, text);
  return NextResponse.json({ ok: true, injected });
}

async function injectWhenReady(taskId: string, text: string): Promise<boolean> {
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`http://localhost:${PORT}/api/internal/terminal/${taskId}/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, submit: true }),
    });
    if (res.ok) return true;
    await new Promise((r) => setTimeout(r, 500)); // 会话未就绪(404)→ 退避重试
  }
  return false;
}
```

> 注:resume 后 CLI TUI 需数秒就绪,`injectWhenReady` 轮询 `/input`(未就绪返回 404)直到成功。后续可改成会话就绪事件回调,Phase 1 先轮询。

- [ ] **Step 2: 端到端 curl 验证(不经飞书)**

对一个已 park(PAUSED + PENDING)的任务:
Run:
```bash
curl -XPOST localhost:3000/api/internal/harness/reply \
  -H 'content-type: application/json' \
  -d '{"taskId":"<id>","text":"选 A,继续"}'
```
Expected: 返回 `{ok:true, injected:true}`;任务终端 resume 且「选 A,继续」被提交;PENDING 请求转 ANSWERED。

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/internal/harness/reply/route.ts"
git commit -m "feat(ai): 入站回复路由 — 应答 + resume + 注入答案"
```

---

## Task 8: 飞书 bot 接线（`~/assistant` 仓库,独立 commit）

> **注意:改的是 `/Users/liujunping/assistant/runtime/bot.js`,不在 tower 仓库。开工前 `pwd` 确认。这是端到端集成,前 7 个 Task 完成且 Tower 侧 curl 全绿后再做。**

**Files:**
- Modify: `~/assistant/runtime/bot.js`
- Modify: `src/mcp/tools/task-tools.ts`(tower 侧:`create_task` 加可选 `notify` 绑定并写 Task.notifyChannel/notifyTarget)

- [ ] **Step 1: create_task 接受来源绑定(tower 侧)**

`create_task` schema 加可选:
```typescript
notify: z.object({ channel: z.string(), target: z.record(z.any()) }).optional()
  .describe("Origin channel binding for ask_human callbacks, e.g. { channel:'feishu', target:{chatId,threadId} }"),
```
create 时写入 `notifyChannel: args.notify?.channel`、`notifyTarget: args.notify ? JSON.stringify(args.notify.target) : null`,并在 unattended 模式下默认 `unattended: true`(或跟随全局默认)。

- [ ] **Step 2: bot 建任务时带上飞书来源(bot 侧)**

`buildContext` 已有 `chat_id` / `thread_root_id`。让 claude 调 `create_task` 时把 `notify:{channel:"feishu",target:{chatId,threadId}}` 一并传入(在 BASE_PROMPT 的建任务纪律里补一条:无人值守任务必须带 notify 来源)。

- [ ] **Step 3: bot 回复分流(bot 侧)**

在 `pollChat` 处理一条 @bot 消息时,先判断:该消息所在线程是否绑定了一个「有 PENDING 请求」的 Tower 任务?
```javascript
// 伪码:bind 已有 state.binds(线程→taskId)。新增:查 Tower 该任务是否在等输入。
const bound = bindGet(m.parent_id, rootId);
if (bound) {
  const waiting = await towerHasPending(bound.taskId); // GET Tower 新增只读接口 /harness/pending?taskId=
  if (waiting) {
    await fetch(`http://localhost:3000/api/internal/harness/reply`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId: bound.taskId, text: clean }),
    });
    await reply(chatId, "已把你的回复转给任务,它继续跑了。", m.message_id, !!m.thread_id);
    continue; // 不 spawn claude
  }
}
// ...否则老流程:spawn claude（建任务/查询/记笔记本职不变）
```
> 需在 tower 侧补一个只读接口 `GET /api/internal/harness/pending?taskId=`(localhost)返回是否有 PENDING,供 bot 判断分流。

- [ ] **Step 4: 端到端手测(真飞书)**

1. 飞书群 @bot 建一个无人值守任务(带 notify 绑定)。
2. 让该任务跑到 `ask_human`。
3. 飞书群收到「🙋 需要你决定…」。
4. 在该线程回复决定。
5. 任务 resume 续跑,bot 回「已转给任务」。
Expected: 全链路通,任务从 park 恢复执行。

- [ ] **Step 5: Commit(两仓库分别提交)**

```bash
# tower 仓库
git add src/mcp/tools/task-tools.ts "src/app/api/internal/harness/pending/route.ts"
git commit -m "feat(mcp): create_task 支持 notify 来源绑定 + /harness/pending 查询"
# assistant 仓库（在 ~/assistant 下单独提交）
```

---

## 验收标准（Phase 1 Done 的定义）

- [ ] Agent 调 `ask_human` → 任务 park:execution `PAUSED`、有 `HumanInputRequest(PENDING)`、PTY 被 kill、**未**产生总结/未转 IN_REVIEW、sessionId 保留。
- [ ] 无人值守 ON 时飞书群收到问题;OFF 时不推送(仅 UI 可见 pending)。
- [ ] `POST /harness/reply` 能把任务从 park 恢复并注入答案续跑(curl 与飞书两条路径都验证)。
- [ ] 出口是平台无关契约:新增渠道 = 实现 `NotifyChannel` + 注册,harness/`ask_human`/`reply` 零改动。
- [ ] bot 双角色清晰:回复走管道转 Tower,其它(建任务/查询)仍走自身 claude。
- [ ] `pnpm test:run` 全绿;`npx tsc --noEmit` 对改动文件无新错误。

## 明确不做（留给后续 Phase）

- Reviewer 验证闸、自动重试(Phase 2)。
- cron/webhook 触发、dead-man 空闲看门狗(Phase 3)。
- OpenClaw / Hermes adapter(契约已就位,各加一个实现即可)。
- 交互卡片/按钮(飞书 bot 是轮询型,Phase 1 用纯文本回复即可)。
