"use client";

import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import { getConfigValue, setConfigValue } from "@/actions/config-actions";
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

export function SystemConfig() {
  const { t } = useI18n();
  const [rules, setRules] = useState<GitPathRule[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<RuleEditState>({ ...EMPTY_FORM });
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<RuleEditState>({ ...EMPTY_FORM });
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  useEffect(() => {
    getConfigValue<GitPathRule[]>("git.pathMappingRules", []).then(setRules);
  }, []);

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
            size="sm"
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
