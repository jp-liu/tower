/**
 * 派生中枢：子任务回合结束时，写进【父任务】终端的「引导 prompt」。
 *
 * 这是内置、**只读**的提示语 —— 故意做成代码常量而不走 SystemConfig：
 * 没有覆盖通道 = 真·只读，UI 只展示、不可编辑。仅用于完成回推：
 * 子任务 stop hook 触发 → notify-parent 用它插值后写父任务 PTY 唤醒父任务 review。
 *
 * 占位符：{{childTitle}} / {{childTaskId}} / {{childReply}}
 */

export const CHILD_REVIEW_PROMPT_TEMPLATE = [
  "[Tower] 你派生的子任务「{{childTitle}}」（taskId: {{childTaskId}}）刚结束一轮、正在等指令 —— 可能完成、也可能没完成。",
  "",
  "子任务最后的回复：",
  "{{childReply}}",
  "",
  "请你作为中枢 review：",
  "1. 若要核实它具体改了什么，用 get_task_terminal_output 读它的终端产出。",
  "2. 若已正确完成 → stop_task_execution 关闭它 + move_task 置 DONE。",
  "3. 若没完成 / 有问题 → send_task_terminal_input 给它具体反馈，让它继续改。",
  "4. 把你的判断与决定用 manage_notes 记录下来，供用户事后查看。",
].join("\n");

export interface ChildReviewVars {
  childTitle: string;
  childTaskId: string;
  childReply: string;
}

/** 用子任务信息插值出最终写入父任务 PTY 的文本。 */
export function buildChildReviewPrompt(vars: ChildReviewVars): string {
  return CHILD_REVIEW_PROMPT_TEMPLATE.replaceAll("{{childTitle}}", vars.childTitle)
    .replaceAll("{{childTaskId}}", vars.childTaskId)
    .replaceAll("{{childReply}}", vars.childReply.trim() || "（无文本回复）");
}
