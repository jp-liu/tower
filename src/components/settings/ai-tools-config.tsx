"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Check, Shield, Settings2, Trash2 } from "lucide-react";

interface AgentConfig {
  id: string;
  agent: string;
  configName: string;
  appendPrompt: string | null;
  settings: Record<string, unknown> | null;
  isDefault: boolean;
}

interface AIToolsConfigProps {
  configs: AgentConfig[];
  onSave: (data: {
    agent: string;
    configName: string;
    isDefault: boolean;
  }) => void;
  onUpdateConfig: (
    id: string,
    data: { appendPrompt?: string; settings?: Record<string, unknown> }
  ) => void;
  onDeleteConfig: (id: string) => void;
}

const AVAILABLE_AGENTS = [
  { value: "CLAUDE_CODE", label: "CLAUDE_CODE" },
  { value: "MINIMAX", label: "MINIMAX" },
];

export function AIToolsConfig({
  configs,
  onSave,
  onUpdateConfig,
  onDeleteConfig,
}: AIToolsConfigProps) {
  const [defaultAgent, setDefaultAgent] = useState(
    configs.find((c) => c.isDefault)?.agent ?? "CLAUDE_CODE"
  );
  const [defaultConfigName, setDefaultConfigName] = useState(
    configs.find((c) => c.isDefault)?.configName ?? "DEFAULT"
  );
  const [editAgent, setEditAgent] = useState("CLAUDE_CODE");
  const [editConfigName, setEditConfigName] = useState("DEFAULT");
  const [editJsonMode, setEditJsonMode] = useState(false);
  const [appendPrompt, setAppendPrompt] = useState(
    configs.find((c) => c.agent === "CLAUDE_CODE" && c.configName === "DEFAULT")
      ?.appendPrompt ?? ""
  );

  const agentConfigs = configs.filter((c) => c.agent === editAgent);
  const selectedConfig = configs.find(
    (c) => c.agent === editAgent && c.configName === editConfigName
  );

  return (
    <div className="space-y-8">
      {/* Header Section */}
      <Card className="border-purple-200 bg-purple-50/30">
        <CardContent className="p-6">
          <div className="flex gap-6">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-medium text-purple-600">AI Tools</span>
              </div>
              <h2 className="text-xl font-bold mb-2">编码代理配置</h2>
              <p className="text-sm text-gray-600">
                配置默认执行器、管理不同 agent 的配置模板，并在表单编辑器与原始 JSON
                之间切换。所有改动都将同步到当前工作台环境。
              </p>
            </div>
            <div className="flex gap-3">
              <Card className="w-40">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Settings2 className="h-4 w-4 text-purple-500" />
                    <span className="text-xs font-medium">默认执行器</span>
                  </div>
                  <p className="text-xs text-gray-500">
                    当前任务创建与自动执行优先使用这里保存的 agent 配置。
                  </p>
                </CardContent>
              </Card>
              <Card className="w-40">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Shield className="h-4 w-4 text-green-500" />
                    <span className="text-xs font-medium">配置一致性</span>
                  </div>
                  <p className="text-xs text-gray-500">
                    支持可视化编辑和 JSON 原始配置，便于团队统一维护执行环境。
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Default Agent Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-purple-100 p-2">
            <Settings2 className="h-5 w-5 text-purple-600" />
          </div>
          <div>
            <h3 className="font-semibold">默认编码代理</h3>
            <p className="text-sm text-gray-500">选择任务的默认编码代理。</p>
          </div>
        </div>

        <Card>
          <CardContent className="p-6 space-y-4">
            <Label className="text-sm text-gray-500">默认代理配置</Label>
            <div className="flex gap-3">
              <Select value={defaultAgent} onValueChange={(v) => v && setDefaultAgent(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AVAILABLE_AGENTS.map((a) => (
                    <SelectItem key={a.value} value={a.value}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={defaultConfigName} onValueChange={(v) => v && setDefaultConfigName(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DEFAULT">默认</SelectItem>
                  {agentConfigs
                    .filter((c) => c.configName !== "DEFAULT")
                    .map((c) => (
                      <SelectItem key={c.configName} value={c.configName}>
                        {c.configName}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {/* Detection banner */}
            <div className="rounded-lg bg-green-50 border border-green-200 p-3">
              <div className="flex items-center gap-2 text-green-700">
                <Check className="h-4 w-4" />
                <span className="text-sm font-medium">检测到最近使用</span>
              </div>
              <p className="mt-1 text-xs text-green-600">
                找到此代理的最近身份验证凭据
              </p>
            </div>

            <p className="text-sm text-gray-500">
              选择创建任务会话时使用的默认代理配置。
            </p>

            <div className="flex justify-end">
              <Button
                onClick={() =>
                  onSave({
                    agent: defaultAgent,
                    configName: defaultConfigName,
                    isDefault: true,
                  })
                }
                className="bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/25 hover:bg-amber-500/25"
              >
                保存
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Separator />

      {/* Agent Config Editor */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-gray-100 p-2">
            <Settings2 className="h-5 w-5 text-gray-600" />
          </div>
          <div>
            <h3 className="font-semibold">编码代理配置</h3>
            <p className="text-sm text-gray-500">
              使用不同的配置自定义编码代理的行为。
            </p>
          </div>
        </div>

        <Card>
          <CardContent className="p-6 space-y-4">
            {/* Edit mode toggle */}
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm text-gray-500">配置编辑模式</Label>
                <p className="text-xs text-gray-400">
                  在表单编辑器与原始 JSON 配置之间切换。
                </p>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-sm text-gray-500">编辑 JSON</span>
                <input
                  type="checkbox"
                  checked={editJsonMode}
                  onChange={(e) => setEditJsonMode(e.target.checked)}
                  className="rounded"
                />
              </label>
            </div>

            <Separator />

            {/* Agent + Config selector */}
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <Label className="text-xs text-gray-500">代理</Label>
                <Select value={editAgent} onValueChange={(v) => v && setEditAgent(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AVAILABLE_AGENTS.map((a) => (
                      <SelectItem key={a.value} value={a.value}>
                        {a.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                <Label className="text-xs text-gray-500">配置</Label>
                <Select value={editConfigName} onValueChange={(v) => v && setEditConfigName(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DEFAULT">DEFAULT</SelectItem>
                    {agentConfigs
                      .filter((c) => c.configName !== "DEFAULT")
                      .map((c) => (
                        <SelectItem key={c.configName} value={c.configName}>
                          {c.configName}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedConfig && !selectedConfig.isDefault && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-5 text-red-500 border-red-200 hover:bg-red-50"
                  onClick={() => onDeleteConfig(selectedConfig.id)}
                >
                  <Trash2 className="h-4 w-4" />
                  删除
                </Button>
              )}
            </div>

            <Separator />

            {/* Append Prompt */}
            {editJsonMode ? (
              <div>
                <Label className="text-sm font-medium">JSON 配置</Label>
                <Textarea
                  className="mt-2 font-mono text-sm"
                  rows={10}
                  value={
                    selectedConfig
                      ? JSON.stringify(selectedConfig.settings ?? {}, null, 2)
                      : "{}"
                  }
                  onChange={(e) => {
                    if (selectedConfig) {
                      try {
                        const settings = JSON.parse(e.target.value);
                        onUpdateConfig(selectedConfig.id, { settings });
                      } catch {
                        // Invalid JSON, don't save
                      }
                    }
                  }}
                />
              </div>
            ) : (
              <div>
                <Label className="text-sm font-medium">Append Prompt</Label>
                <p className="text-xs text-gray-400 mb-2">
                  Extra text appended to the prompt
                </p>
                <Textarea
                  rows={4}
                  value={appendPrompt}
                  onChange={(e) => setAppendPrompt(e.target.value)}
                  onBlur={() => {
                    if (selectedConfig) {
                      onUpdateConfig(selectedConfig.id, {
                        appendPrompt,
                      });
                    }
                  }}
                  placeholder="Enter additional prompt instructions..."
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
