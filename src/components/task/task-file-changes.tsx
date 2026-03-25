interface TaskFileChangesProps {
  added: number;
  removed: number;
}

export function TaskFileChanges({ added, removed }: TaskFileChangesProps) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
      <span>{added + removed} 个文件已更改</span>
      {added > 0 && <span className="text-green-500">+{added}</span>}
      {removed > 0 && <span className="text-red-500">-{removed}</span>}
    </span>
  );
}
