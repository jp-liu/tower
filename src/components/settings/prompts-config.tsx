"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Plus, Star, Trash2, Edit } from "lucide-react";
import {
  getPrompts,
  createPrompt,
  updatePrompt,
  deletePrompt,
  setDefaultPrompt,
} from "@/actions/prompt-actions";
import type { AgentPrompt } from "@prisma/client";

export function PromptsConfig() {
  const { t } = useI18n();
  const router = useRouter();
  const [prompts, setPrompts] = useState<AgentPrompt[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<AgentPrompt | null>(null);
  const [deletePromptId, setDeletePromptId] = useState<string | null>(null);
  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Load prompts on mount
  useEffect(() => {
    getPrompts().then(setPrompts);
  }, []);

  // Open create dialog
  const openCreateDialog = useCallback(() => {
    setEditingPrompt(null);
    setName("");
    setDescription("");
    setContent("");
    setDialogOpen(true);
  }, []);

  // Open edit dialog
  const openEditDialog = useCallback((prompt: AgentPrompt) => {
    setEditingPrompt(prompt);
    setName(prompt.name);
    setDescription(prompt.description ?? "");
    setContent(prompt.content);
    setDialogOpen(true);
  }, []);

  // Open delete confirmation
  const openDeleteConfirm = useCallback((promptId: string) => {
    setDeletePromptId(promptId);
  }, []);

  // Handle create/edit save
  const handleSave = useCallback(async () => {
    if (!name.trim() || !content.trim()) return;
    if (editingPrompt) {
      await updatePrompt(editingPrompt.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        content: content.trim(),
      });
    } else {
      await createPrompt({
        name: name.trim(),
        description: description.trim() || undefined,
        content: content.trim(),
      });
    }
    setDialogOpen(false);
    const updated = await getPrompts();
    setPrompts(updated);
    router.refresh();
  }, [name, description, content, editingPrompt, router]);

  // Handle delete
  const handleDelete = useCallback(async () => {
    if (!deletePromptId) return;
    await deletePrompt(deletePromptId);
    setDeletePromptId(null);
    const updated = await getPrompts();
    setPrompts(updated);
    router.refresh();
  }, [deletePromptId, router]);

  // Handle set default
  const handleSetDefault = useCallback(
    async (promptId: string) => {
      await setDefaultPrompt(promptId);
      const updated = await getPrompts();
      setPrompts(updated);
      router.refresh();
    },
    [router]
  );

  // Panel header
  const panelHeader = (
    <div className="mb-6">
      <h2 className="text-2xl font-bold">{t("settings.prompts.title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("settings.promptsDesc")}
      </p>
    </div>
  );

  if (!mounted)
    return (
      <div className="space-y-4">
        {panelHeader}
        <div className="h-32 rounded-lg bg-muted animate-pulse" />
      </div>
    );

  return (
    <div>
      {panelHeader}

      {/* Create button */}
      <div className="mb-4">
        <Button onClick={openCreateDialog}>
          <Plus className="h-4 w-4 mr-2" />
          {t("settings.prompts.newPrompt")}
        </Button>
      </div>

      {/* Prompt list */}
      {prompts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-muted-foreground">{t("settings.prompts.empty")}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("settings.prompts.emptyHint")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {prompts.map((prompt) => (
            <Card key={prompt.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium truncate">{prompt.name}</h4>
                      {prompt.isDefault && (
                        <Badge variant="secondary" className="shrink-0">
                          <Star className="h-3 w-3 mr-1 fill-yellow-400 text-yellow-400" />
                          {t("settings.prompts.default")}
                        </Badge>
                      )}
                    </div>
                    {prompt.description && (
                      <p className="mt-1 text-sm text-muted-foreground truncate">
                        {prompt.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleSetDefault(prompt.id)}
                      title={t("settings.prompts.setDefault")}
                    >
                      <Star
                        className={`h-4 w-4 ${
                          prompt.isDefault
                            ? "fill-yellow-400 text-yellow-400"
                            : "text-muted-foreground"
                        }`}
                      />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => openEditDialog(prompt)}
                      title={t("settings.prompts.editPrompt")}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => openDeleteConfirm(prompt.id)}
                      className="text-destructive"
                      title={t("settings.prompts.delete")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingPrompt
                ? t("settings.prompts.editPrompt")
                : t("settings.prompts.newPrompt")}
            </DialogTitle>
            <DialogDescription>
              {editingPrompt
                ? t("settings.prompts.editPrompt")
                : t("settings.prompts.newPrompt")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="prompt-name">
                {t("settings.prompts.promptName")}
              </Label>
              <Input
                id="prompt-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("settings.prompts.promptNamePlaceholder")}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="prompt-description">
                {t("settings.prompts.promptDescription")}
              </Label>
              <Input
                id="prompt-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("settings.prompts.promptDescriptionPlaceholder")}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="prompt-content">
                {t("settings.prompts.promptContent")}
              </Label>
              <Textarea
                id="prompt-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={t("settings.prompts.promptContentPlaceholder")}
                rows={8}
                className="mt-1.5 font-mono text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t("settings.prompts.cancel")}
            </Button>
            <Button
              onClick={handleSave}
              disabled={!name.trim() || !content.trim()}
            >
              {t("settings.prompts.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!deletePromptId}
        onOpenChange={(open) => !open && setDeletePromptId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("settings.prompts.deleteConfirmTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("settings.prompts.deleteConfirmMessage")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletePromptId(null)}>
              {t("settings.prompts.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              {t("settings.prompts.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
