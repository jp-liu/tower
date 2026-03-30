"use client";

import { useState, useTransition, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, FileText, Plus } from "lucide-react";
import type { ProjectNote } from "@prisma/client";
import { useI18n } from "@/lib/i18n";
import { NOTE_CATEGORIES_PRESET } from "@/lib/constants";
import { createNote, updateNote, deleteNote, getProjectNotes } from "@/actions/note-actions";
import { CategoryFilter } from "@/components/notes/category-filter";
import { NoteList } from "@/components/notes/note-list";
import { NoteEditor } from "@/components/notes/note-editor";
import type { NoteItem } from "@/components/notes/note-card";

interface SimpleProject {
  id: string;
  name: string;
  alias: string | null;
}

interface SimpleWorkspace {
  id: string;
  name: string;
  projects: SimpleProject[];
}

interface NotesPageClientProps {
  allWorkspaces: SimpleWorkspace[];
  initialWorkspaceId: string;
  initialProjectId: string | null;
  initialNotes: ProjectNote[];
}

export function NotesPageClient({
  allWorkspaces,
  initialWorkspaceId,
  initialProjectId,
  initialNotes,
}: NotesPageClientProps) {
  const { t } = useI18n();
  const [isPending, startTransition] = useTransition();

  // Selection state — pure client, no router
  const [selectedWsId, setSelectedWsId] = useState(initialWorkspaceId);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(initialProjectId);

  // Data state
  const [notes, setNotes] = useState<ProjectNote[]>(initialNotes);
  const [activeCategory, setActiveCategory] = useState("all");

  // Form state
  const [editingNote, setEditingNote] = useState<NoteItem | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formContent, setFormContent] = useState("");
  const [formCategory, setFormCategory] = useState<string>(NOTE_CATEGORIES_PRESET[3]);

  // Derived
  const currentWs = allWorkspaces.find((ws) => ws.id === selectedWsId);
  const projects = currentWs?.projects ?? [];

  // Reload notes for the selected project
  const reloadNotes = useCallback(
    (projectId: string | null) => {
      if (!projectId) {
        setNotes([]);
        return;
      }
      startTransition(async () => {
        const freshNotes = await getProjectNotes(projectId);
        setNotes(freshNotes);
      });
    },
    [startTransition]
  );

  // Handlers: workspace / project switch
  const handleWsChange = (wsId: string) => {
    setSelectedWsId(wsId);
    const ws = allWorkspaces.find((w) => w.id === wsId);
    const firstProject = ws?.projects[0] ?? null;
    setSelectedProjectId(firstProject?.id ?? null);
    setActiveCategory("all");
    handleCancel();
    reloadNotes(firstProject?.id ?? null);
  };

  const handleProjectChange = (projectId: string) => {
    setSelectedProjectId(projectId);
    setActiveCategory("all");
    handleCancel();
    reloadNotes(projectId);
  };

  // Handlers: CRUD
  const handleNewNote = () => {
    setFormTitle("");
    setFormContent("");
    setFormCategory(NOTE_CATEGORIES_PRESET[3]);
    setEditingNote(null);
    setIsCreating(true);
  };

  const handleEditNote = (note: NoteItem) => {
    setFormTitle(note.title);
    setFormContent(note.content);
    setFormCategory(note.category);
    setEditingNote(note);
    setIsCreating(false);
  };

  const handleCancel = () => {
    setIsCreating(false);
    setEditingNote(null);
  };

  const handleCreate = async () => {
    if (!selectedProjectId || !formTitle.trim()) return;
    await createNote({
      title: formTitle.trim(),
      content: formContent,
      category: formCategory,
      projectId: selectedProjectId,
    });
    setIsCreating(false);
    reloadNotes(selectedProjectId);
  };

  const handleUpdate = async () => {
    if (!editingNote || !formTitle.trim()) return;
    await updateNote(editingNote.id, {
      title: formTitle.trim(),
      content: formContent,
      category: formCategory,
    });
    setEditingNote(null);
    reloadNotes(selectedProjectId);
  };

  const handleDelete = async (noteId: string) => {
    const noteToDelete = notes.find((n) => n.id === noteId);
    if (!noteToDelete) return;
    if (!confirm(t("notes.deleteConfirm", { title: noteToDelete.title }))) return;
    await deleteNote(noteId);
    reloadNotes(selectedProjectId);
  };

  // Filtered notes
  const filteredNotes: NoteItem[] =
    activeCategory === "all"
      ? notes.map((n) => ({ ...n, updatedAt: new Date(n.updatedAt) }))
      : notes
          .filter((n) => n.category === activeCategory)
          .map((n) => ({ ...n, updatedAt: new Date(n.updatedAt) }));

  const showForm = isCreating || editingNote !== null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-6 py-4">
        <Link
          href={`/workspaces/${selectedWsId}`}
          className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>{t("notes.backToBoard")}</span>
        </Link>
        <span className="text-border">·</span>
        <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span>{t("notes.title")}</span>
        </div>

        {/* Workspace selector */}
        <select
          value={selectedWsId}
          onChange={(e) => handleWsChange(e.target.value)}
          className="ml-2 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/50"
        >
          {allWorkspaces.map((ws) => (
            <option key={ws.id} value={ws.id}>
              {ws.name}
            </option>
          ))}
        </select>

        {/* Project selector */}
        {projects.length > 0 && (
          <select
            value={selectedProjectId ?? ""}
            onChange={(e) => handleProjectChange(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/50"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.alias ? ` (${p.alias})` : ""}
              </option>
            ))}
          </select>
        )}

        {/* New note button */}
        {selectedProjectId && !showForm && (
          <button
            onClick={handleNewNote}
            className="ml-auto flex items-center gap-1.5 rounded-md bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-300 ring-1 ring-amber-500/25 hover:bg-amber-500/25 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{t("notes.newNote")}</span>
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {projects.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm font-medium text-muted-foreground">{t("notes.noProject")}</p>
            <p className="text-xs text-muted-foreground/60">{t("notes.noProjectHint")}</p>
          </div>
        ) : showForm ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder={t("notes.titlePlaceholder")}
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/50"
              />
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground">{t("notes.categoryLabel")}</label>
                <select
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                >
                  {NOTE_CATEGORIES_PRESET.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <NoteEditor value={formContent} onChange={setFormContent} />

            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={handleCancel}
                className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                {t("notes.cancel")}
              </button>
              <button
                onClick={editingNote ? handleUpdate : handleCreate}
                disabled={!formTitle.trim()}
                className="rounded-md bg-amber-500/15 px-4 py-2 text-sm font-medium text-amber-300 ring-1 ring-amber-500/25 hover:bg-amber-500/25 disabled:opacity-30 transition-colors"
              >
                {t("notes.save")}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {isPending && (
              <div className="text-xs text-muted-foreground animate-pulse">{t("notes.loading")}</div>
            )}
            <CategoryFilter active={activeCategory} onSelect={setActiveCategory} />
            <NoteList
              notes={filteredNotes}
              onEdit={handleEditNote}
              onDelete={handleDelete}
            />
          </div>
        )}
      </div>
    </div>
  );
}
