import { execFileSync } from "child_process";

const GIT_TIMEOUT = 5000;

/** 取某分支（或 ref）的 HEAD commit；失败返回 null。 */
export function getBranchHead(cwd: string, branch: string): string | null {
  try {
    const out = execFileSync("git", ["rev-parse", branch], { cwd, encoding: "utf-8", timeout: GIT_TIMEOUT });
    const hash = out.trim();
    return hash || null;
  } catch (_e) {
    return null;
  }
}

export interface DiffStat { additions: number; deletions: number; files: number; }

/** 计算 from..to 的增删行数与文件数；失败返回全 0。 */
export function getDiffStat(cwd: string, from: string, to: string): DiffStat {
  try {
    const out = execFileSync("git", ["diff", "--numstat", `${from}..${to}`], { cwd, encoding: "utf-8", timeout: GIT_TIMEOUT });
    let additions = 0, deletions = 0, files = 0;
    for (const line of out.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      const [add, del] = t.split("\t");
      additions += Number.parseInt(add, 10) || 0;
      deletions += Number.parseInt(del, 10) || 0;
      files += 1;
    }
    return { additions, deletions, files };
  } catch (_e) {
    return { additions: 0, deletions: 0, files: 0 };
  }
}
