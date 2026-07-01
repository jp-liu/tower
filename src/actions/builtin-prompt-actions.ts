"use server";

import { db } from "@/lib/db";
import { getConfigValue, setConfigValue } from "./config-actions";
import { CONFIG_DEFAULTS } from "@/lib/config-defaults";
import { CHILD_REVIEW_PROMPT_TEMPLATE } from "@/lib/derive/child-review-prompt";

// 两个「内置提示语」的读写：
//  - 系统声明 task.systemDirective：built-in，默认值在 config-defaults（删不掉 = 不可删），
//    可经 SystemConfig 覆盖（可修改）；「恢复默认」= 删除 override 回落到代码默认。
//  - 子任务回推引导 prompt：代码常量，只读（无覆盖通道）。
const SYSTEM_DIRECTIVE_KEY = "task.systemDirective";

function directiveDefault(): string {
  return CONFIG_DEFAULTS[SYSTEM_DIRECTIVE_KEY].defaultValue as string;
}

export interface BuiltinPromptsData {
  /** 系统声明当前值（override 或默认）。 */
  systemDirective: string;
  /** 系统声明的内置默认（用于「恢复默认」和「已修改」标记）。 */
  systemDirectiveDefault: string;
  /** 当前值是否为用户自定义（≠ 默认）。 */
  systemDirectiveIsCustom: boolean;
  /** 子任务回推引导 prompt（只读，带 {{childTitle}}/{{childTaskId}}/{{childReply}} 占位）。 */
  childReviewPrompt: string;
}

export async function getBuiltinPrompts(): Promise<BuiltinPromptsData> {
  const def = directiveDefault();
  const current = await getConfigValue<string>(SYSTEM_DIRECTIVE_KEY, def);
  return {
    systemDirective: current,
    systemDirectiveDefault: def,
    systemDirectiveIsCustom: current !== def,
    childReviewPrompt: CHILD_REVIEW_PROMPT_TEMPLATE,
  };
}

export async function saveSystemDirective(value: string): Promise<void> {
  await setConfigValue(SYSTEM_DIRECTIVE_KEY, value);
}

/** 恢复默认：删除 SystemConfig override，读回时自动回落到 config-defaults 的内置默认。 */
export async function resetSystemDirective(): Promise<string> {
  await db.systemConfig.deleteMany({ where: { key: SYSTEM_DIRECTIVE_KEY } });
  return directiveDefault();
}
