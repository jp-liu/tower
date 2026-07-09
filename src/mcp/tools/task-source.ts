// Server-side resolution of a task's `## 来源` section — the hard-rule half of
// the source model. A task is created through one of four channels:
//   ① assistant panel   ② normal task terminal   — no external source
//   ③ parent-derived (TOWER_TASK_ID)  ④ bridge platform (<task-source> block)
// Only ③④ carry structured provenance. This module guarantees, independent of
// whether the calling model followed the skill, that:
//   - a `<task-source>` bridge block is never stored raw (structural stripping)
//     and is rendered into a channel-generic `## 来源`;
//   - a parent-derived task records its parent even if the model omitted it;
//   - any described task without a source ends with `## 来源\n无`.
// Semantic niceties (role inference, summary derivation) stay soft in the skill.

/** Bridge `channel` → human-readable prefix. `channel` is the real platform
 *  (WeChat / Feishu), NOT the transport bot — the bot goes in `bridge`. Unknown
 *  channels fall back to the raw value so new platforms render acceptably. */
const CHANNEL_PREFIX: Record<string, string> = {
  feishu: "飞书群",
  lark: "Lark 群",
  wechat: "微信群",
  wecom: "企业微信群",
  openclaw: "OpenClaw",
  manual: "手动创建",
};

export function channelLabel(channel: string, chatName?: string | null): string {
  const prefix = CHANNEL_PREFIX[channel.toLowerCase()] ?? channel;
  return chatName ? `${prefix}「${chatName}」` : prefix;
}

const TASK_SOURCE_RE = /<task-source>([\s\S]*?)<\/task-source>/i;
// Global variant used only for stripping. TASK_SOURCE_RE (non-global) captures
// the FIRST block for rendering, but a bare `.replace()` with it removes just
// that first match — any additional <task-source> blocks would stay stored raw,
// breaking the never-store-raw guarantee. Strip with the global one.
const TASK_SOURCE_STRIP_RE = /<task-source>[\s\S]*?<\/task-source>/gi;
const SOURCE_SECTION_RE = /(^|\n)##\s*来源\s*(\n|$)/;

export function hasSourceSection(description: string): boolean {
  return SOURCE_SECTION_RE.test(description);
}

export interface TaskSourceData {
  channel: string;
  chatName?: string;
  chatId?: string;
  occurredAt?: string;
  chatLink?: string;
  triggerMessageId?: string;
  threadRootId?: string;
  summary?: string;
  bridge?: string;
  participants?: string[];
  transcript?: string;
}

/**
 * Parse a `<task-source>` block body (flat `key: value` lines, a `participants:`
 * list, and a `transcript: |` block scalar). Deliberately tiny — no YAML dep;
 * we only read the fields the render needs. Returns null when `channel` is
 * missing (channel is the one required anchor).
 */
export function parseTaskSourceBlock(body: string): TaskSourceData | null {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const flat: Record<string, string> = {};
  const participants: string[] = [];
  let transcript: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    // transcript block scalar: capture subsequent more-indented lines verbatim.
    const transMatch = /^transcript:\s*\|?\s*$/.exec(trimmed);
    if (transMatch) {
      const baseIndent = line.length - line.trimStart().length;
      const collected: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const l = lines[j];
        if (l.trim() === "") {
          collected.push("");
          continue;
        }
        const indent = l.length - l.trimStart().length;
        if (indent <= baseIndent) break;
        collected.push(l.slice(baseIndent + 2));
      }
      transcript = collected.join("\n").replace(/\n+$/, "").trim();
      i = j - 1;
      continue;
    }

    // participants list item: "- name: 张三, open_id: ou_x, role: 讨论"
    if (trimmed.startsWith("- ")) {
      const nameMatch = /name:\s*([^,]+)/.exec(trimmed);
      participants.push(nameMatch ? nameMatch[1].trim() : trimmed.slice(2).trim());
      continue;
    }
    if (trimmed === "participants:") continue;

    const kv = /^([a-z_]+):\s*(.*)$/i.exec(trimmed);
    if (kv && kv[2] !== "") flat[kv[1].toLowerCase()] = kv[2].trim();
  }

  if (!flat.channel) return null;
  return {
    channel: flat.channel,
    chatName: flat.chat_name,
    chatId: flat.chat_id,
    occurredAt: flat.occurred_at,
    chatLink: flat.chat_link,
    triggerMessageId: flat.trigger_message_id,
    threadRootId: flat.thread_root_id,
    summary: flat.summary,
    bridge: flat.bridge,
    participants: participants.length ? participants : undefined,
    transcript,
  };
}

/** Render a bridge `<task-source>` into a channel-generic `## 来源` section.
 *  Only deterministic fields are emitted; role/summary inference stays soft. */
export function renderBridgeSource(data: TaskSourceData): string {
  const lines: string[] = ["## 来源", "", `- 渠道：${channelLabel(data.channel, data.chatName)}`];
  if (data.bridge) lines.push(`- 传输：${data.bridge}`);
  if (data.occurredAt) lines.push(`- 时间：${data.occurredAt}`);
  if (data.participants?.length) lines.push(`- 参与者：${data.participants.join("、")}`);
  if (data.summary) lines.push(`- 讨论要点：${data.summary}`);
  if (data.chatLink) lines.push(`- 打开群：${data.chatLink}`);
  const anchors: string[] = [];
  if (data.chatId) anchors.push(`chat=${data.chatId}`);
  if (data.triggerMessageId) anchors.push(`msg=${data.triggerMessageId}`);
  if (data.threadRootId) anchors.push(`thread=${data.threadRootId}`);
  if (anchors.length) lines.push(`- 溯源 ID：${anchors.join(" · ")}`);
  if (data.transcript) lines.push("", "讨论摘录（按时间）：", data.transcript);
  return lines.join("\n");
}

/** Render the parent-derivation `## 来源` for a child task. */
export function renderParentSource(parent: { id: string; title?: string | null }): string {
  const label = parent.title ? `${parent.title}（id: ${parent.id}）` : `id: ${parent.id}`;
  return ["## 来源", "", "- 渠道：父任务派生", `- 父任务：${label}`].join("\n");
}

function appendSection(description: string | undefined, section: string): string {
  const base = (description ?? "").trimEnd();
  return base ? `${base}\n\n${section}` : section;
}

/**
 * Resolve the final description, guaranteeing a correct `## 来源` regardless of
 * what the model produced. Precedence:
 *   1. `<task-source>` block present → strip it, render bridge source (unless the
 *      model already wrote its own `## 来源`).
 *   2. parent-derived and no `## 来源` yet → append parent source.
 *   3. described but no `## 来源` → append `## 来源\n无`.
 *   4. no description and no parent → leave undefined (nothing to source).
 */
export function resolveTaskSource(
  description: string | undefined,
  parent: { id: string; title?: string | null } | null,
): string | undefined {
  const match = description ? TASK_SOURCE_RE.exec(description) : null;
  if (match && description) {
    const stripped = description.replace(TASK_SOURCE_STRIP_RE, "").replace(/\n{3,}/g, "\n\n").trim();
    if (hasSourceSection(stripped)) return stripped;
    const data = parseTaskSourceBlock(match[1]);
    return data ? appendSection(stripped, renderBridgeSource(data)) : appendSection(stripped, "## 来源\n\n无");
  }

  if (parent) {
    if (description && hasSourceSection(description)) return description;
    return appendSection(description, renderParentSource(parent));
  }

  if (description && description.trim() && !hasSourceSection(description)) {
    return appendSection(description, "## 来源\n\n无");
  }

  return description;
}
