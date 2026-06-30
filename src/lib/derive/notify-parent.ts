/**
 * 派生中枢：子任务发生事件时通知【父任务】—— 把消息写进父任务的 PTY 唤醒它。
 *
 * 当前触发点：子任务 stop hook（回合结束）→ notifyParentOnChildStop。
 * 设计成独立模块，将来别的父子事件（子任务报错、需要输入等）也走这里，
 * stop route 只是它的第一个调用方（见 .claude/rules/process-lifecycle.md 的 fan-out 约定）。
 *
 * 规则：本任务有 parentTaskId 且父任务 PTY 仍活着才推；否则跳过
 * （用户设定：父任务没启动就不发）。best-effort —— 失败只 warn，绝不抛错影响 stop 主流程。
 */
import { db } from "@/lib/db";
import { getSession } from "@/lib/pty/session-store";
import { planTerminalWrite } from "@/lib/pty/terminal-submit";
import { buildChildReviewPrompt } from "@/lib/derive/child-review-prompt";

// 消息体与回车必须分两次写、间隔一拍，否则 Claude TUI 会把尾部 CR 折进文本而不提交。
const SUBMIT_DELAY_MS = 80;

/**
 * 子任务一轮结束 → 若有在跑的父任务，写一段 review 引导 prompt 进父任务 PTY 唤醒它。
 * @param childTaskId 结束的子任务 id
 * @param childTitle  子任务标题
 * @param lastReply   子任务最后一条回复（供父任务初判，可空）
 */
export async function notifyParentOnChildStop(
  childTaskId: string,
  childTitle: string,
  lastReply: string
): Promise<void> {
  try {
    const child = await db.task.findUnique({
      where: { id: childTaskId },
      select: { parentTaskId: true },
    });
    const parentId = child?.parentTaskId;
    if (!parentId) return; // 不是派生任务，无父可通知

    const parentSession = getSession(parentId);
    if (!parentSession || parentSession.killed) return; // 父任务没在跑 → 跳过

    const text = buildChildReviewPrompt({ childTitle, childTaskId, childReply: lastReply });
    const { body, submitKey } = planTerminalWrite(text, true);
    if (body) parentSession.write(body);
    if (submitKey) {
      setTimeout(() => {
        const s = getSession(parentId);
        if (s && !s.killed) s.write(submitKey);
      }, SUBMIT_DELAY_MS);
    }
  } catch (err) {
    console.warn("[notify-parent] failed to notify parent task:", err);
  }
}
