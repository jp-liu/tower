import { ArrowLeft } from "lucide-react";
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
    <div className="border-b px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-purple-600 font-medium">&#10024; 任务对话</span>
        </div>
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" />
          返回任务列表
        </button>
      </div>

      <h2 className="mt-2 text-xl font-bold">{title}</h2>

      {description && (
        <p className="mt-1 text-sm text-gray-500 line-clamp-2">{description}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {branch && (
          <Badge variant="secondary" className="bg-gray-100 text-gray-600 text-xs">
            {branch}
          </Badge>
        )}
        {hasConversation && (
          <Badge variant="secondary" className="bg-blue-50 text-blue-600 text-xs">
            已有会话
          </Badge>
        )}
        <span className="text-xs text-gray-400">
          更新于 {formatRelativeTime(updatedAt)}
        </span>
      </div>
    </div>
  );
}
