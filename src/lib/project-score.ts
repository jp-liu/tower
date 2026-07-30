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
  }

  const descScore = project.description?.toLowerCase().includes(q) ? DESC_CONTAINS : 0;
  return Math.max(nameScore, aliasScore, descScore);
}
