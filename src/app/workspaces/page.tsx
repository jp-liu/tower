import { Layers } from "lucide-react";

export default function WorkspacesPage() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 ring-1 ring-amber-500/20">
          <Layers className="h-7 w-7 text-amber-400/60" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">选择一个工作空间</h2>
        <p className="mt-1 text-sm text-muted-foreground">从左侧选择一个工作空间开始</p>
      </div>
    </div>
  );
}
