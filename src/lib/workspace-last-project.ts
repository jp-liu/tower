/**
 * 记忆每个工作区上次高亮选中的项目。
 *
 * 数据量很小（一个工作区只记一个 projectId），用 localStorage 持久化一个
 * `workspaceId → projectId` 的 Map。切换工作区时读取以恢复高亮，选中项目时更新。
 */

const STORAGE_KEY = "workspace-last-project";

type ProjectMap = Record<string, string>;

function readMap(): ProjectMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as ProjectMap) : {};
  } catch {
    return {};
  }
}

/** 读取某工作区上次高亮的项目 ID；无记录返回 null。 */
export function getLastProjectId(workspaceId: string): string | null {
  return readMap()[workspaceId] ?? null;
}

/** 记录某工作区当前高亮的项目 ID（不可变更新整个 Map）。 */
export function setLastProjectId(workspaceId: string, projectId: string): void {
  if (typeof window === "undefined") return;
  try {
    const map = readMap();
    if (map[workspaceId] === projectId) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...map, [workspaceId]: projectId }));
  } catch {
    // 忽略序列化 / 配额错误 —— 记忆高亮属于增强体验，失败不影响主流程
  }
}
