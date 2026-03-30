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

  // List view selection state (for browsing)
  const [listWsId, setListWsId] = useState(initialWorkspaceId);
  const [listProjectId, setListProjectId] = useState<string | null>(initialProjectId);

  // Data state
  const [notes, setNotes] = useState<ProjectNote[]>(initialNotes);
  const [activeCategory, setActiveCategory] = useState("all");

  // Form state (independent from list view)
  const [editingNote, setEditingNote] = useState<NoteItem | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formContent, setFormContent] = useState("");
  const [formCategory, setFormCategory] = useState<string>(NOTE_CATEGORIES_PRESET[3]);
  const [formWsId, setFormWsId] = useState(initialWorkspaceId);
  const [formProjectId, setFormProjectId] = useState<string | null>(initialProjectId);

  // Derived
  const listWs = allWorkspaces.find((ws) => ws.id === listWsId);
  const listProjects = listWs?.projects ?? [];
  const formWs = allWorkspaces.find((ws) => ws.id === formWsId);
  const formProjects = formWs?.projects ?? [];

  // Reload notes for the list view
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

  // List view handlers
  const handleListWsChange = (wsId: string) => {
    setListWsId(wsId);
    const ws = allWorkspaces.find((w) => w.id === wsId);
    const firstProject = ws?.projects[0] ?? null;
    setListProjectId(firstProject?.id ?? null);
    setActiveCategory("all");
    reloadNotes(firstProject?.id ?? null);
  };

  const handleListProjectChange = (projectId: string) => {
    setListProjectId(projectId);
    setActiveCategory("all");
    reloadNotes(projectId);
  };

  // Form workspace/project handlers (don't affect list view)
  const handleFormWsChange = (wsId: string) => {
    setFormWsId(wsId);
    const ws = allWorkspaces.find((w) => w.id === wsId);
    const firstProject = ws?.projects[0] ?? null;
    setFormProjectId(firstProject?.id ?? null);
  };

  // CRUD handlers
  const handleNewNote = () => {
    setFormTitle("");
    setFormContent("");
    setFormCategory(NOTE_CATEGORIES_PRESET[3]);
    // Default form selectors to current list view selection
    setFormWsId(listWsId);
    setFormProjectId(listProjectId);
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
    if (!formProjectId || !formTitle.trim()) return;
    await createNote({
      title: formTitle.trim(),
      content: formContent,
      category: formCategory,
      projectId: formProjectId,
    });
    setIsCreating(false);
    // If we created in the same project as list view, reload
    if (formProjectId === listProjectId) {
      reloadNotes(listProjectId);
    }
  };

  const handleUpdate = async () => {
    if (!editingNote || !formTitle.trim()) return;
    await updateNote(editingNote.id, {
      title: formTitle.trim(),
      content: formContent,
      category: formCategory,
    });
    setEditingNote(null);
    reloadNotes(listProjectId);
  };

  const handleDelete = async (noteId: string) => {
    const noteToDelete = notes.find((n) => n.id === noteId);
    if (!noteToDelete) return;
    if (!confirm(t("notes.deleteConfirm", { title: noteToDelete.title }))) return;
    await deleteNote(noteId);
    reloadNotes(listProjectId);
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
      {/* Header — clean, just nav + title + new button */}
      <div className="flex items-center gap-3 border-b border-border px-6 py-4">
        <Link
          href={`/workspaces/${listWsId}`}
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
        {!showForm && (
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
      <div className="flex-1 overflow-hidden px-6 py-4 flex flex-col">
        {showForm ? (
          /* ── Create / Edit form with its own workspace+project selectors ── */
          <div className="flex flex-col gap-4 flex-1 min-h-0">
            {/* Form selectors row */}
            <div className="flex items-center gap-3 flex-wrap">
              {/* Workspace selector (only for create, not edit) */}
              {!editingNote && (
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground whitespace-nowrap">{t("notes.workspace")}</label>
                  <select
                    value={formWsId}
                    onChange={(e) => handleFormWsChange(e.target.value)}
                    className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                  >
                    {allWorkspaces.map((ws) => (
                      <option key={ws.id} value={ws.id}>{ws.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {/* Project selector (only for create, not edit) */}
              {!editingNote && formProjects.length > 0 && (
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground whitespace-nowrap">{t("notes.project")}</label>
                  <select
                    value={formProjectId ?? ""}
                    onChange={(e) => setFormProjectId(e.target.value)}
                    className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                  >
                    {formProjects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}{p.alias ? ` (${p.alias})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {/* Category selector */}
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground whitespace-nowrap">{t("notes.categoryLabel")}</label>
                <select
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                >
                  {NOTE_CATEGORIES_PRESET.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Title input */}
            <input
              type="text"
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              placeholder={t("notes.titlePlaceholder")}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/50"
            />

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
                disabled={!formTitle.trim() || (!editingNote && !formProjectId)}
                className="rounded-md bg-amber-500/15 px-4 py-2 text-sm font-medium text-amber-300 ring-1 ring-amber-500/25 hover:bg-amber-500/25 disabled:opacity-30 transition-colors"
              >
                {t("notes.save")}
              </button>
            </div>
          </div>
        ) : (
          /* ── List view with its own workspace+project filter ── */
          <div className="space-y-4">
            {/* List selectors */}
            <div className="flex items-center gap-3 flex-wrap">
              <select
                value={listWsId}
                onChange={(e) => handleListWsChange(e.target.value)}
                className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/50"
              >
                {allWorkspaces.map((ws) => (
                  <option key={ws.id} value={ws.id}>{ws.name}</option>
                ))}
              </select>
              {listProjects.length > 0 && (
                <select
                  value={listProjectId ?? ""}
                  onChange={(e) => handleListProjectChange(e.target.value)}
                  className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                >
                  {listProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.alias ? ` (${p.alias})` : ""}
                    </option>
                  ))}
                </select>
              )}
              <CategoryFilter active={activeCategory} onSelect={setActiveCategory} />
            </div>

            {isPending && (
              <div className="text-xs text-muted-foreground animate-pulse">{t("notes.loading")}</div>
            )}

            {listProjects.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                <p className="text-sm font-medium text-muted-foreground">{t("notes.noProject")}</p>
                <p className="text-xs text-muted-foreground/60">{t("notes.noProjectHint")}</p>
              </div>
            ) : (
              <NoteList
                notes={filteredNotes}
                onEdit={handleEditNote}
                onDelete={handleDelete}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
