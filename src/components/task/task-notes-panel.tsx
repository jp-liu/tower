"use client";

import { useState, useEffect, useRef } from "react";
import { Plus, Trash2, Upload, FileText, Paperclip, X, Eye, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { createNote, getTaskNotes, deleteNote } from "@/actions/note-actions";
import { getTaskAssets, uploadAsset, deleteAsset } from "@/actions/asset-actions";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ImageLightbox } from "@/components/assets/image-lightbox";
import { TextPreviewDialog } from "@/components/assets/text-preview-dialog";
import { localPathToApiUrl, isImageAsset } from "@/lib/file-serve-client";
import { toast } from "sonner";

interface TaskNotesPanelProps {
  taskId: string;
  projectId: string;
}

interface NoteItem {
  id: string;
  title: string;
  content: string;
  createdAt: Date;
}

interface AssetItem {
  id: string;
  filename: string;
  path: string;
  mimeType: string | null;
  size: number | null;
  createdAt: Date;
}

const TEXT_PREVIEW_PATTERN = /\.(txt|md|json)$/i;

export function TaskNotesPanel({ taskId, projectId }: TaskNotesPanelProps) {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [showAddNote, setShowAddNote] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [uploading, setUploading] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<AssetItem | null>(null);

  useEffect(() => {
    getTaskNotes(taskId).then(setNotes);
    getTaskAssets(taskId).then(setAssets);
  }, [taskId]);

  async function handleAddNote() {
    if (!noteTitle.trim()) return;
    await createNote({
      title: noteTitle.trim(),
      content: noteContent.trim(),
      projectId,
      taskId,
      category: "task",
    });
    setNoteTitle("");
    setNoteContent("");
    setShowAddNote(false);
    getTaskNotes(taskId).then(setNotes);
  }

  async function handleDeleteNote(noteId: string) {
    await deleteNote(noteId);
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("projectId", projectId);
      formData.set("taskId", taskId);
      await uploadAsset(formData);
      getTaskAssets(taskId).then(setAssets);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDeleteAsset(assetId: string) {
    await deleteAsset(assetId);
    setAssets((prev) => prev.filter((a) => a.id !== assetId));
  }

  function isPreviewable(asset: AssetItem) {
    return isImageAsset(asset.filename, asset.mimeType) || TEXT_PREVIEW_PATTERN.test(asset.filename);
  }

  function handlePreview(asset: AssetItem) {
    if (isPreviewable(asset)) {
      setPreviewAsset(asset);
    } else {
      toast.info(t("assets.previewNotSupported"));
    }
  }

  async function handleReveal(asset: AssetItem) {
    try {
      const res = await fetch("/api/internal/assets/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: asset.path }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Failed to reveal file");
      }
    } catch {
      toast.error("Failed to reveal file");
    }
  }

  function formatSize(bytes: number | null) {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  const previewType = previewAsset
    ? isImageAsset(previewAsset.filename, previewAsset.mimeType)
      ? "image"
      : TEXT_PREVIEW_PATTERN.test(previewAsset.filename)
        ? "text"
        : null
    : null;

  // Image-only list (same order as assets) for lightbox prev/next
  const imageAssets = assets
    .filter((a) => isImageAsset(a.filename, a.mimeType))
    .map((a) => ({
      id: a.id,
      url: localPathToApiUrl(a.path),
      filename: a.filename,
    }));

  const currentImageIndex = previewAsset
    ? imageAssets.findIndex((a) => a.id === previewAsset.id)
    : -1;

  return (
    <>
      <ScrollArea className="h-full"><div className="flex flex-col">
        {/* Notes section */}
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <FileText className="h-3.5 w-3.5" />
              {t("taskPage.notes")}
            </h3>
            <Button
              variant="ghost"

              className="h-6 gap-1 px-2 text-xs"
              onClick={() => setShowAddNote(!showAddNote)}
            >
              {showAddNote ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
              {showAddNote ? "" : t("taskPage.addNote")}
            </Button>
          </div>

          {/* Add note form */}
          {showAddNote && (
            <div className="mt-3 space-y-2">
              <input
                type="text"
                value={noteTitle}
                onChange={(e) => setNoteTitle(e.target.value)}
                placeholder={t("taskPage.noteTitle")}
                className="h-8 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                autoFocus
              />
              <textarea
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                placeholder={t("taskPage.noteContent")}
                rows={3}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              />
              <Button className="text-xs" onClick={handleAddNote} disabled={!noteTitle.trim()}>
                {t("taskPage.addNote")}
              </Button>
            </div>
          )}

          {/* Notes list */}
          <div className="mt-2 space-y-2">
            {notes.length === 0 && !showAddNote && (
              <p className="text-xs text-muted-foreground py-2">{t("taskPage.noNotes")}</p>
            )}
            {notes.map((note) => (
              <div key={note.id} className="group rounded-md border border-border bg-card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-medium truncate">{note.title}</h4>
                    {note.content && (
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">{note.content}</p>
                    )}
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {new Date(note.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleDeleteNote(note.id)}
                    className="shrink-0 text-muted-foreground opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                    title={t("taskPage.deleteNote")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Attachments section */}
        <div className="px-4 py-3">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Paperclip className="h-3.5 w-3.5" />
              {t("taskPage.attachments")}
            </h3>
            <Button
              variant="ghost"

              className="h-6 gap-1 px-2 text-xs"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              <Upload className="h-3 w-3" />
              {t("taskPage.uploadFile")}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleUpload}
            />
          </div>

          <div className="mt-2 space-y-1.5">
            {assets.length === 0 && (
              <p className="text-xs text-muted-foreground py-2">{t("taskPage.noAttachments")}</p>
            )}
            {assets.map((asset) => {
              const canPreview = isPreviewable(asset);
              return (
                <div key={asset.id} className="group flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
                  <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <button
                    type="button"
                    onClick={() => handlePreview(asset)}
                    disabled={!canPreview}
                    className={`min-w-0 flex-1 truncate text-left text-sm ${canPreview ? "cursor-pointer hover:underline" : "cursor-default"}`}
                    title={canPreview ? t("assets.preview") : asset.filename}
                  >
                    {asset.filename}
                  </button>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{formatSize(asset.size)}</span>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                    {canPreview && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => handlePreview(asset)}
                        className="shrink-0 text-muted-foreground hover:bg-accent"
                        title={t("assets.preview")}
                      >
                        <Eye className="h-3 w-3" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleReveal(asset)}
                      className="shrink-0 text-muted-foreground hover:bg-accent"
                      title={t("assets.revealInFinder")}
                    >
                      <FolderOpen className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleDeleteAsset(asset.id)}
                      className="shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      title={t("taskPage.deleteAttachment")}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div></ScrollArea>

      <ImageLightbox
        imageUrl={
          previewType === "image" && currentImageIndex >= 0
            ? imageAssets[currentImageIndex].url
            : null
        }
        filename={
          previewType === "image" && currentImageIndex >= 0
            ? imageAssets[currentImageIndex].filename
            : ""
        }
        open={previewType === "image"}
        onOpenChange={(open) => { if (!open) setPreviewAsset(null); }}
        assets={imageAssets.map(({ url, filename }) => ({ url, filename }))}
        currentIndex={currentImageIndex >= 0 ? currentImageIndex : undefined}
        onIndexChange={(nextIndex) => {
          const target = imageAssets[nextIndex];
          if (!target) return;
          const orig = assets.find((a) => a.id === target.id);
          if (orig) setPreviewAsset(orig);
        }}
      />
      <TextPreviewDialog
        url={previewType === "text" && previewAsset ? localPathToApiUrl(previewAsset.path) : null}
        filename={previewAsset?.filename ?? ""}
        open={previewType === "text"}
        onOpenChange={(open) => { if (!open) setPreviewAsset(null); }}
      />
    </>
  );
}
