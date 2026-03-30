"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface NoteEditorProps {
  value: string;
  onChange: (val: string) => void;
}

export function NoteEditor({ value, onChange }: NoteEditorProps) {
  return (
    <div className="relative grid grid-cols-2 gap-4 flex-1 min-h-64">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 w-1/2 pr-2 resize-none font-mono text-sm border rounded-md p-3 bg-background text-foreground border-border focus:outline-none focus:ring-1 focus:ring-amber-500/50"
        placeholder="Write Markdown here..."
      />
      <div className="absolute inset-0 left-1/2 pl-2">
        <div className="h-full overflow-y-auto border rounded-md p-3 border-border prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
