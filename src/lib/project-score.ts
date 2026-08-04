const NAME_EXACT = 1.0;
const NAME_STARTS_WITH = 0.9;
const NAME_CONTAINS = 0.75;
const ALIAS_EXACT = 0.85;
const ALIAS_STARTS_WITH = 0.75;
const ALIAS_CONTAINS = 0.6;
const DESC_CONTAINS = 0.4;

interface ProjectFields {
  name: string;
  alias: string | null;
  description?: string | null;
  groupName?: string | null;
}

const LABEL_SEPARATORS = /[,，、;；|]+/u;
const LABEL_PUNCTUATION = /[\s\-_–—/\\()（）\[\]【】:&＆]+/gu;
const PRODUCT_ROLE_SUFFIXES = [
  "自动化知识库",
  "需求原型",
  "knowledgebase",
  "frontend",
  "backend",
  "static",
  "知识库",
  "自动化",
  "前端",
  "后端",
  "原型",
  "系统",
] as const;

function normalizedLabel(value: string): string {
  return value.toLowerCase().replace(LABEL_PUNCTUATION, "");
}

function productLabel(value: string): string {
  let result = normalizedLabel(value);
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of PRODUCT_ROLE_SUFFIXES) {
      if (result.length > suffix.length + 1 && result.endsWith(suffix)) {
        result = result.slice(0, -suffix.length);
        changed = true;
        break;
      }
    }
  }
  return result;
}

function productLabelScore(value: string, query: string, score: number): number {
  const q = productLabel(query);
  const candidate = productLabel(value);
  if (q.length < 2 || candidate.length < 2) return 0;
  return candidate === q ? score : 0;
}

/** Shared scoring contract used by identify_project and gateway resolution. */
export function scoreProject(project: ProjectFields, query: string): number {
  const q = query.toLowerCase();
  const name = project.name.toLowerCase();
  let nameScore = 0;
  if (name === q) nameScore = NAME_EXACT;
  else if (name.startsWith(q)) nameScore = NAME_STARTS_WITH;
  else if (name.includes(q)) nameScore = NAME_CONTAINS;

  let aliasScore = 0;
  if (project.alias) {
    const alias = project.alias.toLowerCase();
    if (alias === q) aliasScore = ALIAS_EXACT;
    else if (alias.startsWith(q)) aliasScore = ALIAS_STARTS_WITH;
    else if (alias.includes(q)) aliasScore = ALIAS_CONTAINS;
    aliasScore = Math.max(
      aliasScore,
      ...project.alias
        .split(LABEL_SEPARATORS)
        .map((part) => productLabelScore(part, query, 0.55)),
    );
  }

  let descScore = project.description?.toLowerCase().includes(q) ? DESC_CONTAINS : 0;
  if (project.description) {
    descScore = Math.max(descScore, productLabelScore(project.description, query, 0.35));
  }
  const groupScore = project.groupName
    ? Math.max(
        normalizedLabel(project.groupName) === normalizedLabel(query) ? 0.8 : 0,
        productLabelScore(project.groupName, query, 0.65),
      )
    : 0;
  return Math.max(nameScore, aliasScore, descScore, groupScore);
}
