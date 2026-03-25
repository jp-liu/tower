import { ArrowLeft, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/lib/utils";

interface TaskMetadataProps {
  title: string;
  description?: string;
  branch?: string;
  hasConversation: boolean;
  updatedAt: Date;
  onBack: () => void;
}

export function TaskMetadata({
  title,
  description,
  branch,
  hasConversation,
  updatedAt,
  onBack,
}: TaskMetadataProps) {
  return (
    <div className="border-b border-border px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-amber-400" />
          <span className="text-xs font-semibold text-amber-300">任务对话</span>
        </div>
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          返回任务列表
        </button>
      </div>

      <h2 className="mt-2.5 text-lg font-bold tracking-tight text-foreground">{title}</h2>

      {description && (
        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{description}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {branch && (
          <Badge variant="secondary" className="bg-muted text-muted-foreground text-[10px] font-mono border border-border">
            {branch}
          </Badge>
        )}
        {hasConversation && (
          <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-400 text-[10px] border border-emerald-500/20">
            已有会话
          </Badge>
        )}
        <span className="text-[11px] text-muted-foreground">
          更新于 {formatRelativeTime(updatedAt)}
        </span>
      </div>
    </div>
  );
}
