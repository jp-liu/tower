interface MergeInput<T extends { executionId: string }> {
  prev: T[];
  fresh: T[];
  removingIds: ReadonlySet<string>;
}

interface MergeResult<T extends { executionId: string }> {
  merged: T[];
  goneIds: string[];
}

export function mergeMissions<T extends { executionId: string }>({
  prev,
  fresh,
  removingIds,
}: MergeInput<T>): MergeResult<T> {
  const freshIds = new Set(fresh.map((e) => e.executionId));
  const goneIds: string[] = [];
  prev.forEach((c) => {
    if (!freshIds.has(c.executionId) && !removingIds.has(c.executionId)) {
      goneIds.push(c.executionId);
    }
  });
  const retained = prev.filter(
    (c) => freshIds.has(c.executionId) || removingIds.has(c.executionId)
  );
  const prevIds = new Set(prev.map((c) => c.executionId));
  const added = fresh.filter((e) => !prevIds.has(e.executionId));
  return { merged: [...retained, ...added], goneIds };
}
