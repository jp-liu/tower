"use client";

import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import { getConfigValue, setConfigValue, getConfigValues } from "@/actions/config-actions";
import type { GitPathRule } from "@/lib/git-url";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Plus, Trash2, Edit, Save, X } from "lucide-react";

type RuleEditState = {
  host: string;
  ownerMatch: string;
  localPathTemplate: string;
  priority: number;
};

const EMPTY_FORM: RuleEditState = {
  host: "",
  ownerMatch: "*",
  localPathTemplate: "",
  priority: 0,
};

type SystemForm = { maxUploadMb: number; maxConcurrent: number };
type GitParamsForm = { timeoutSec: number };
type SearchForm = { resultLimit: number; allModeCap: number; debounceMs: number; snippetLength: number };
type MissionsGridForm = { minCols: number; maxCols: number; minRows: number; maxRows: number };

export function SystemConfig() {
  const { t } = useI18n();
  const [rules, setRules] = useState<GitPathRule[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<RuleEditState>({ ...EMPTY_FORM });
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<RuleEditState>({ ...EMPTY_FORM });
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [systemForm, setSystemForm] = useState<SystemForm>({ maxUploadMb: 50, maxConcurrent: 3 });
  const [gitParamsForm, setGitParamsForm] = useState<GitParamsForm>({ timeoutSec: 30 });
  const [searchForm, setSearchForm] = useState<SearchForm>({ resultLimit: 20, allModeCap: 5, debounceMs: 250, snippetLength: 80 });
  const [missionsGridForm, setMissionsGridForm] = useState<MissionsGridForm>({ minCols: 1, maxCols: 5, minRows: 1, maxRows: 5 });

  useEffect(() => {
    getConfigValue<GitPathRule[]>("git.pathMappingRules", []).then(setRules);
    getConfigValues([
      "system.maxUploadBytes",
      "system.maxConcurrentExecutions",
      "git.timeoutSec",
      "search.resultLimit",
      "search.allModeCap",
      "search.debounceMs",
      "search.snippetLength",
      "missions.grid.minCols",
      "missions.grid.maxCols",
      "missions.grid.minRows",
      "missions.grid.maxRows",
    ]).then((cfg) => {
      const maxBytes = (cfg["system.maxUploadBytes"] as number) ?? 52428800;
      setSystemForm({
        maxUploadMb: Math.round(maxBytes / 1024 / 1024),
        maxConcurrent: (cfg["system.maxConcurrentExecutions"] as number) ?? 3,
      });
      setGitParamsForm({
        timeoutSec: (cfg["git.timeoutSec"] as number) ?? 30,
      });
      setSearchForm({
        resultLimit: (cfg["search.resultLimit"] as number) ?? 20,
        allModeCap: (cfg["search.allModeCap"] as number) ?? 5,
        debounceMs: (cfg["search.debounceMs"] as number) ?? 250,
        snippetLength: (cfg["search.snippetLength"] as number) ?? 80,
      });
      setMissionsGridForm({
        minCols: (cfg["missions.grid.minCols"] as number) ?? 1,
        maxCols: (cfg["missions.grid.maxCols"] as number) ?? 5,
        minRows: (cfg["missions.grid.minRows"] as number) ?? 1,
        maxRows: (cfg["missions.grid.maxRows"] as number) ?? 5,
      });
    });
  }, []);

  const handleSaveSystem = async () => {
    await setConfigValue("system.maxUploadBytes", systemForm.maxUploadMb * 1024 * 1024);
    await setConfigValue("system.maxConcurrentExecutions", systemForm.maxConcurrent);
  };

  const handleSaveGitParams = async () => {
    await setConfigValue("git.timeoutSec", gitParamsForm.timeoutSec);
  };

  const handleSaveSearch = async () => {
    await setConfigValue("search.resultLimit", searchForm.resultLimit);
    await setConfigValue("search.allModeCap", searchForm.allModeCap);
    await setConfigValue("search.debounceMs", searchForm.debounceMs);
    await setConfigValue("search.snippetLength", searchForm.snippetLength);
  };

  const handleSaveMissionsGrid = async () => {
    // Ensure min <= max; auto-swap if inverted
    const minCols = Math.min(missionsGridForm.minCols, missionsGridForm.maxCols);
    const maxCols = Math.max(missionsGridForm.minCols, missionsGridForm.maxCols);
    const minRows = Math.min(missionsGridForm.minRows, missionsGridForm.maxRows);
    const maxRows = Math.max(missionsGridForm.minRows, missionsGridForm.maxRows);
    setMissionsGridForm({ minCols, maxCols, minRows, maxRows });
    await setConfigValue("missions.grid.minCols", minCols);
    await setConfigValue("missions.grid.maxCols", maxCols);
    await setConfigValue("missions.grid.minRows", minRows);
    await setConfigValue("missions.grid.maxRows", maxRows);
  };

  const handleAddRule = async () => {
    if (!addForm.host.trim() || !addForm.localPathTemplate.trim()) return;
    const newRule: GitPathRule = {
      id: crypto.randomUUID(),
      host: addForm.host.trim(),
      ownerMatch: addForm.ownerMatch.trim() || "*",
      localPathTemplate: addForm.localPathTemplate.trim(),
      priority: addForm.priority,
    };
    const updated = [...rules, newRule];
    await setConfigValue("git.pathMappingRules", updated);
    setRules(updated);
    setAddForm({ ...EMPTY_FORM });
    setShowAddForm(false);
  };

  const handleEditStart = (rule: GitPathRule) => {
    setEditingId(rule.id);
    setEditForm({
      host: rule.host,
      ownerMatch: rule.ownerMatch,
      localPathTemplate: rule.localPathTemplate,
      priority: rule.priority,
    });
  };

  const handleEditSave = async (ruleId: string) => {
    if (!editForm.host.trim() || !editForm.localPathTemplate.trim()) return;
    const updated = rules.map((r) =>
      r.id === ruleId
        ? {
            ...r,
            host: editForm.host.trim(),
            ownerMatch: editForm.ownerMatch.trim() || "*",
            localPathTemplate: editForm.localPathTemplate.trim(),
            priority: editForm.priority,
          }
        : r
    );
    await setConfigValue("git.pathMappingRules", updated);
    setRules(updated);
    setEditingId(null);
  };

  const handleEditCancel = () => {
    setEditingId(null);
  };

  const handleDeleteRule = async (ruleId: string) => {
    const updated = rules.filter((r) => r.id !== ruleId);
    await setConfigValue("git.pathMappingRules", updated);
    setRules(updated);
    setDeleteConfirmId(null);
  };

  return (
    <div>
      <h2 className="text-2xl font-bold">{t("settings.config")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("settings.configDesc")}
      </p>

      {/* Git Path Mapping Rules section */}
      <div className="mt-8">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">
              {t("settings.config.git.title")}
            </h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t("settings.config.git.desc")}
            </p>
          </div>
          <Button
           
            onClick={() => {
              setAddForm({ ...EMPTY_FORM });
              setShowAddForm(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            {t("settings.config.git.addRule")}
          </Button>
        </div>

        {/* Rules table */}
        <div className="mt-4 rounded-lg border">
          {rules.length === 0 && !showAddForm ? (
            <div className="rounded-lg border-dashed p-8 text-center">
              <p className="text-sm text-muted-foreground">
                {t("settings.config.git.noRules")}
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                    {t("settings.config.git.host")}
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                    {t("settings.config.git.ownerMatch")}
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                    {t("settings.config.git.localPathTemplate")}
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground w-20">
                    {t("settings.config.git.priority")}
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground w-24">
                    {t("settings.config.git.actions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) =>
                  editingId === rule.id ? (
                    <tr key={rule.id} className="border-b">
                      <td className="px-2 py-1.5">
                        <Input
                          value={editForm.host}
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, host: e.target.value }))
                          }
                          placeholder={t("settings.config.git.hostPlaceholder")}
                          className="h-8 text-sm"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          value={editForm.ownerMatch}
                          onChange={(e) =>
                            setEditForm((f) => ({
                              ...f,
                              ownerMatch: e.target.value,
                            }))
                          }
                          placeholder={t(
                            "settings.config.git.ownerMatchPlaceholder"
                          )}
                          className="h-8 text-sm"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          value={editForm.localPathTemplate}
                          onChange={(e) =>
                            setEditForm((f) => ({
                              ...f,
                              localPathTemplate: e.target.value,
                            }))
                          }
                          placeholder={t(
                            "settings.config.git.localPathTemplatePlaceholder"
                          )}
                          className="h-8 text-sm"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          type="number"
                          value={editForm.priority}
                          onChange={(e) =>
                            setEditForm((f) => ({
                              ...f,
                              priority: Number(e.target.value),
                            }))
                          }
                          className="h-8 w-16 text-sm"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleEditSave(rule.id)}
                            title={t("settings.config.git.save")}
                          >
                            <Save className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={handleEditCancel}
                            title={t("settings.config.git.cancel")}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={rule.id} className="border-b last:border-0">
                      <td className="px-3 py-2">{rule.host}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {rule.ownerMatch}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {rule.localPathTemplate}
                      </td>
                      <td className="px-3 py-2">{rule.priority}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleEditStart(rule)}
                            title={t("settings.config.git.edit")}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setDeleteConfirmId(rule.id)}
                            className="text-destructive"
                            title={t("settings.config.git.delete")}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                )}

                {/* Inline add form row */}
                {showAddForm && (
                  <tr className="border-t bg-muted/30">
                    <td className="px-2 py-1.5">
                      <Input
                        value={addForm.host}
                        onChange={(e) =>
                          setAddForm((f) => ({ ...f, host: e.target.value }))
                        }
                        placeholder={t("settings.config.git.hostPlaceholder")}
                        className="h-8 text-sm"
                        autoFocus
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        value={addForm.ownerMatch}
                        onChange={(e) =>
                          setAddForm((f) => ({
                            ...f,
                            ownerMatch: e.target.value,
                          }))
                        }
                        placeholder={t(
                          "settings.config.git.ownerMatchPlaceholder"
                        )}
                        className="h-8 text-sm"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <div>
                        <Input
                          value={addForm.localPathTemplate}
                          onChange={(e) =>
                            setAddForm((f) => ({
                              ...f,
                              localPathTemplate: e.target.value,
                            }))
                          }
                          placeholder={t(
                            "settings.config.git.localPathTemplatePlaceholder"
                          )}
                          className="h-8 text-sm"
                        />
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {t("settings.config.git.templateHint")}
                        </p>
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        type="number"
                        value={addForm.priority}
                        onChange={(e) =>
                          setAddForm((f) => ({
                            ...f,
                            priority: Number(e.target.value),
                          }))
                        }
                        className="h-8 w-16 text-sm"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={handleAddRule}
                          title={t("settings.config.git.save")}
                        >
                          <Save className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setShowAddForm(false)}
                          title={t("settings.config.git.cancel")}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* System Parameters section */}
      <div className="mt-8">
        <h3 className="text-lg font-semibold">{t("settings.config.system.title")}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("settings.config.system.desc")}</p>
        <div className="mt-4 space-y-4">
          {/* Max upload size */}
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium">{t("settings.config.system.maxUpload")}</label>
              <p className="text-xs text-muted-foreground">{t("settings.config.system.maxUploadHint")}</p>
            </div>
            <div className="flex items-center gap-2">
              <Input type="number" min={1} max={500}
                value={systemForm.maxUploadMb}
                onChange={(e) => setSystemForm((f) => ({ ...f, maxUploadMb: Number(e.target.value) }))}
                className="w-24 text-right" />
              <span className="text-sm text-muted-foreground">MB</span>
            </div>
          </div>
          {/* Max concurrent executions */}
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium">{t("settings.config.system.maxConcurrent")}</label>
              <p className="text-xs text-muted-foreground">{t("settings.config.system.maxConcurrentHint")}</p>
            </div>
            <Input type="number" min={1} max={10}
              value={systemForm.maxConcurrent}
              onChange={(e) => setSystemForm((f) => ({ ...f, maxConcurrent: Number(e.target.value) }))}
              className="w-24 text-right" />
          </div>
          <Button onClick={handleSaveSystem}>{t("common.save")}</Button>
        </div>
      </div>

      {/* Git Parameters section */}
      <div className="mt-8">
        <h3 className="text-lg font-semibold">{t("settings.config.gitParams.title")}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("settings.config.gitParams.desc")}</p>
        <div className="mt-4 space-y-4">
          {/* Git timeout */}
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium">{t("settings.config.gitParams.timeout")}</label>
              <p className="text-xs text-muted-foreground">{t("settings.config.gitParams.timeoutHint")}</p>
            </div>
            <div className="flex items-center gap-2">
              <Input type="number" min={5} max={300}
                value={gitParamsForm.timeoutSec}
                onChange={(e) => setGitParamsForm((f) => ({ ...f, timeoutSec: Number(e.target.value) }))}
                className="w-24 text-right" />
              <span className="text-sm text-muted-foreground">s</span>
            </div>
          </div>
          <Button onClick={handleSaveGitParams}>{t("common.save")}</Button>
        </div>
      </div>

      {/* Search Parameters section */}
      <div className="mt-8">
        <h3 className="text-lg font-semibold">{t("settings.config.search.title")}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("settings.config.search.desc")}</p>
        <div className="mt-4 space-y-4">
          {/* Result limit */}
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium">{t("settings.config.search.resultLimit")}</label>
              <p className="text-xs text-muted-foreground">{t("settings.config.search.resultLimitHint")}</p>
            </div>
            <Input type="number" min={5} max={100}
              value={searchForm.resultLimit}
              onChange={(e) => setSearchForm((f) => ({ ...f, resultLimit: Number(e.target.value) }))}
              className="w-24 text-right" />
          </div>
          {/* All-mode cap */}
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium">{t("settings.config.search.allModeCap")}</label>
              <p className="text-xs text-muted-foreground">{t("settings.config.search.allModeCapHint")}</p>
            </div>
            <Input type="number" min={1} max={20}
              value={searchForm.allModeCap}
              onChange={(e) => setSearchForm((f) => ({ ...f, allModeCap: Number(e.target.value) }))}
              className="w-24 text-right" />
          </div>
          {/* Debounce */}
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium">{t("settings.config.search.debounceMs")}</label>
              <p className="text-xs text-muted-foreground">{t("settings.config.search.debounceMsHint")}</p>
            </div>
            <div className="flex items-center gap-2">
              <Input type="number" min={50} max={1000}
                value={searchForm.debounceMs}
                onChange={(e) => setSearchForm((f) => ({ ...f, debounceMs: Number(e.target.value) }))}
                className="w-24 text-right" />
              <span className="text-sm text-muted-foreground">ms</span>
            </div>
          </div>
          {/* Snippet length */}
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium">{t("settings.config.search.snippetLength")}</label>
              <p className="text-xs text-muted-foreground">{t("settings.config.search.snippetLengthHint")}</p>
            </div>
            <Input type="number" min={20} max={500}
              value={searchForm.snippetLength}
              onChange={(e) => setSearchForm((f) => ({ ...f, snippetLength: Number(e.target.value) }))}
              className="w-24 text-right" />
          </div>
          <Button onClick={handleSaveSearch}>{t("common.save")}</Button>
        </div>
      </div>

      {/* Missions Grid Layout section */}
      <div className="mt-8">
        <h3 className="text-lg font-semibold">{t("settings.config.missions.title")}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("settings.config.missions.desc")}</p>
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-4">
              <label className="text-sm font-medium flex-1">{t("settings.config.missions.minCols")}</label>
              <Input type="number" min={1} max={10}
                value={missionsGridForm.minCols}
                onChange={(e) => setMissionsGridForm((f) => ({ ...f, minCols: Number(e.target.value) }))}
                className="w-20 text-right" />
            </div>
            <div className="flex items-center gap-4">
              <label className="text-sm font-medium flex-1">{t("settings.config.missions.maxCols")}</label>
              <Input type="number" min={1} max={10}
                value={missionsGridForm.maxCols}
                onChange={(e) => setMissionsGridForm((f) => ({ ...f, maxCols: Number(e.target.value) }))}
                className="w-20 text-right" />
            </div>
            <div className="flex items-center gap-4">
              <label className="text-sm font-medium flex-1">{t("settings.config.missions.minRows")}</label>
              <Input type="number" min={1} max={10}
                value={missionsGridForm.minRows}
                onChange={(e) => setMissionsGridForm((f) => ({ ...f, minRows: Number(e.target.value) }))}
                className="w-20 text-right" />
            </div>
            <div className="flex items-center gap-4">
              <label className="text-sm font-medium flex-1">{t("settings.config.missions.maxRows")}</label>
              <Input type="number" min={1} max={10}
                value={missionsGridForm.maxRows}
                onChange={(e) => setMissionsGridForm((f) => ({ ...f, maxRows: Number(e.target.value) }))}
                className="w-20 text-right" />
            </div>
          </div>
          <Button onClick={handleSaveMissionsGrid}>{t("common.save")}</Button>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!deleteConfirmId}
        onOpenChange={(open) => !open && setDeleteConfirmId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.config.git.deleteConfirm")}</DialogTitle>
            <DialogDescription>
              {t("settings.config.git.deleteConfirmMessage")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
              {t("settings.config.git.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                deleteConfirmId && handleDeleteRule(deleteConfirmId)
              }
            >
              {t("settings.config.git.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
