"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Settings2 } from "lucide-react";

const DEFAULT_CLI_ADAPTER_KEY = "ai-manager:default-cli-adapter";

const CLI_ADAPTERS = [
  { value: "claude_code", label: "Claude Code" },
];

export function AIToolsConfig() {
  const [defaultAdapter, setDefaultAdapter] = useState("claude_code");

  useEffect(() => {
    const stored = localStorage.getItem(DEFAULT_CLI_ADAPTER_KEY);
    if (stored) {
      setDefaultAdapter(stored);
    }
  }, []);

  const handleAdapterChange = (value: string | null, _eventDetails: unknown) => {
    if (!value) return;
    setDefaultAdapter(value);
    localStorage.setItem(DEFAULT_CLI_ADAPTER_KEY, value);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-purple-100 dark:bg-purple-900/30 p-2">
          <Settings2 className="h-5 w-5 text-purple-600 dark:text-purple-400" />
        </div>
        <div>
          <h3 className="font-semibold">默认 CLI 适配器</h3>
          <p className="text-sm text-muted-foreground">选择任务执行时默认使用的 CLI 适配器。</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-6 space-y-4">
          <Label className="text-sm text-muted-foreground">CLI 适配器</Label>
          <Select value={defaultAdapter} onValueChange={handleAdapterChange}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CLI_ADAPTERS.map((adapter) => (
                <SelectItem key={adapter.value} value={adapter.value}>
                  {adapter.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            该设置保存在本地，用于确定调用哪个 CLI 工具执行任务。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
