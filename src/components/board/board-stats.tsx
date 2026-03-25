import { ClipboardList, Zap, Lightbulb } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface BoardStatsProps {
  totalTasks: number;
  runningTasks: number;
  tip: string;
  tipDescription?: string;
}

export function BoardStats({ totalTasks, runningTasks, tip, tipDescription }: BoardStatsProps) {
  return (
    <div className="grid grid-cols-3 gap-4 px-6 py-4">
      <Card>
        <CardContent className="flex items-start gap-3 p-4">
          <div className="rounded-lg bg-blue-50 p-2">
            <ClipboardList className="h-5 w-5 text-blue-500" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">项目概览</p>
            <p className="text-2xl font-bold">{totalTasks}</p>
            <p className="text-xs text-muted-foreground">当前筛选条件下的任务总数</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-start gap-3 p-4">
          <div className="rounded-lg bg-yellow-50 p-2">
            <Zap className="h-5 w-5 text-yellow-500" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">执行状态</p>
            <p className="text-2xl font-bold">{runningTasks}</p>
            <p className="text-xs text-muted-foreground">正在运行或等待工具继续处理的任务</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-start gap-3 p-4">
          <div className="rounded-lg bg-purple-50 p-2">
            <Lightbulb className="h-5 w-5 text-purple-500" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">工作流提示</p>
            <p className="text-sm font-semibold">{tip}</p>
            {tipDescription && (
              <p className="text-xs text-muted-foreground">{tipDescription}</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
