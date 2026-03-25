import { ClipboardList, Zap, Lightbulb } from "lucide-react";

interface BoardStatsProps {
  totalTasks: number;
  runningTasks: number;
  tip: string;
  tipDescription?: string;
}

export function BoardStats({ totalTasks, runningTasks, tip, tipDescription }: BoardStatsProps) {
  return (
    <div className="grid grid-cols-3 gap-3 px-6 py-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-sky-500/10 p-2 ring-1 ring-sky-500/20">
            <ClipboardList className="h-4 w-4 text-sky-400" />
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">概览</p>
            <p className="text-2xl font-bold font-mono tracking-tight text-foreground">{totalTasks}</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-amber-500/10 p-2 ring-1 ring-amber-500/20">
            <Zap className="h-4 w-4 text-amber-400" />
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">执行中</p>
            <p className="text-2xl font-bold font-mono tracking-tight text-foreground">{runningTasks}</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-emerald-500/10 p-2 ring-1 ring-emerald-500/20">
            <Lightbulb className="h-4 w-4 text-emerald-400" />
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">提示</p>
            <p className="text-xs font-medium text-foreground/80">{tip}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
