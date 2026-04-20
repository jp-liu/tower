# Phase 3: Agent Prompt Management - Research

**Researched:** 2026-03-26
**Domain:** Prompt CRUD UI + isDefault transaction enforcement
**Confidence:** HIGH

## Summary

Phase 3 adds a Prompts settings panel to the existing Settings page. The data layer (Prisma model `AgentPrompt`, server actions in `prompt-actions.ts`) already exists but needs one critical fix: `isDefault` enforcement requires wrapping the "clear all defaults + set new default" in a `db.$transaction()`. All five requirements (PMPT-01 through PMPT-05) are supported by the existing infrastructure with this one server-action fix plus the UI component.

**Primary recommendation:** Create `src/components/settings/prompts-config.tsx` as a client component that loads prompts via `getPrompts()`, renders them in a Card list, and uses a Dialog for create/edit forms. Add a new `setDefaultPrompt(promptId)` server action that uses `db.$transaction()` to clear existing defaults and set the new one atomically.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| shadcn/ui Dialog | via `@base-ui/react/dialog` | Create/edit prompt form in modal | Already in codebase |
| shadcn/ui Card | `src/components/ui/card.tsx` | Prompt list items | Already in codebase |
| shadcn/ui Badge | `src/components/ui/badge.tsx` | Default indicator | Already in codebase |
| shadcn/ui Button, Input, Textarea, Label, Separator | existing | Form controls | Already in codebase |

### Supporting
| Library | Purpose | When to Use |
|---------|---------|-------------|
| `db.$transaction()` (Prisma) | Atomic isDefault toggle | `setDefaultPrompt` server action |
| `useState` + `useCallback` | Local UI state | Dialog open/close, form state |
| `useTransition` + `router.refresh()` | Server revalidation | After mutations |

**No new packages required.**

## Architecture Patterns

### Recommended Project Structure
```
src/
├── actions/
│   └── prompt-actions.ts     # ADD: setDefaultPrompt() with $transaction
├── components/settings/
│   └── prompts-config.tsx    # NEW: main prompts panel
└── lib/
    └── i18n.tsx              # ADD: prompt CRUD i18n keys
```

### Pattern 1: Settings Panel Component (following `general-config.tsx`)
**What:** A client component that fetches data and renders a settings section.
**When to use:** The Prompts panel needs to load and display the list.
**Example:**
```tsx
// src/components/settings/prompts-config.tsx
"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { getPrompts, createPrompt, updatePrompt, deletePrompt, setDefaultPrompt } from "@/actions/prompt-actions";
import { useI18n } from "@/lib/i18n";
import { Plus, Star, Trash2, Edit } from "lucide-react";

interface AgentPrompt { id: string; name: string; description?: string; content: string; isDefault: boolean; }

export function PromptsConfig() {
  const { t } = useI18n();
  const router = useRouter();
  const [prompts, setPrompts] = useState<AgentPrompt[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<AgentPrompt | null>(null);
  // form state: name, description, content
  // ...
}
```

### Pattern 2: Dialog for Create/Edit Form
**What:** A modal dialog that collects prompt name, description, and content.
**When to use:** Creating a new prompt or editing an existing one.
**Key:** Name and content are required; description is optional.
**Reference:** `Dialog` component API from `src/components/ui/dialog.tsx` (uses `@base-ui/react/dialog`).

### Pattern 3: isDefault Transaction
**What:** When setting a prompt as default, clear all other defaults in the same workspace first, atomically.
**Why:** SQLite/Prisma does not support deferrable constraints by default; `isDefault` is a boolean (not enum), so only one row can be true.
**Code:**
```typescript
// src/actions/prompt-actions.ts
export async function setDefaultPrompt(promptId: string, workspaceId?: string) {
  return db.$transaction(async (tx) => {
    // Clear all existing defaults
    await tx.agentPrompt.updateMany({
      where: workspaceId ? { workspaceId, isDefault: true } : { isDefault: true },
      data: { isDefault: false },
    });
    // Set the new default
    return tx.agentPrompt.update({
      where: { id: promptId },
      data: { isDefault: true },
    });
  });
}
```

### Pattern 4: Delete with Confirmation
**What:** Show a confirmation step before deleting.
**When to use:** PMPT-03 requires a confirmation step.
**UX:** Can use a `Dialog` with "Cancel" and "Delete" buttons, where Delete is destructive-styled.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| isDefault exclusivity | Custom SQL triggers or application-level loops | `db.$transaction()` | Atomic, single round-trip, Prisma-native |
| Form validation | Custom regex/validation | Controlled components + required HTML attribute | Simpler, sufficient for this use case |
| List re-render after mutations | Manual state patching | `router.refresh()` from `next/navigation` | Consistent with existing codebase pattern |

## Common Pitfalls

### Pitfall 1: isDefault Race Condition
**What goes wrong:** Two concurrent requests to set different prompts as default could leave multiple defaults set.
**Why it happens:** Without a transaction, "clear A's default, set B's default" is two separate DB operations that can interleave.
**How to avoid:** Use `db.$transaction()` for the clear + set as a single atomic operation.
**Warning signs:** Multiple prompts showing default indicator simultaneously.

### Pitfall 2: Orphaned Default on Delete
**What goes wrong:** Deleting the default prompt leaves no prompt marked as default (unless handled).
**How to avoid:** No special action needed per requirements -- deleting the default is allowed. The UI should handle "no default" state gracefully (no default badge shown).
**Warning signs:** No prompt has `isDefault: true` after delete.

### Pitfall 3: Unvalidated Form Input
**What goes wrong:** Empty name or content strings get saved to the database.
**How to avoid:** HTML `required` attribute + server-side check in `createPrompt`/`updatePrompt`. The existing server actions check content length (100k char limit) but not emptiness.

### Pitfall 4: Dialog Form Reset
**What goes wrong:** Closing and reopening a dialog still shows the previous edit values.
**How to avoid:** Reset form state when opening the dialog (set to empty for create, set to prompt values for edit).

## Code Examples

### Prompt List Item (Card)
```tsx
<Card key={prompt.id} className="group relative">
  <CardContent className="p-4">
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h4 className="font-medium truncate">{prompt.name}</h4>
          {prompt.isDefault && (
            <Badge variant="secondary" className="shrink-0">
              <Star className="h-3 w-3 mr-1" />
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
        <Button variant="ghost" size="icon-sm" onClick={() => handleSetDefault(prompt.id)}>
          <Star className={`h-4 w-4 ${prompt.isDefault ? "fill-yellow-400 text-yellow-400" : ""}`} />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => openEditDialog(prompt)}>
          <Edit className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => openDeleteConfirm(prompt.id)}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    </div>
  </CardContent>
</Card>
```

### isDefault Transaction (new server action)
```typescript
// src/actions/prompt-actions.ts
export async function setDefaultPrompt(
  promptId: string,
  workspaceId?: string
) {
  const prompt = await db.$transaction(async (tx) => {
    // Clear existing defaults in scope
    const whereClause = workspaceId
      ? { workspaceId, isDefault: true }
      : { isDefault: true };
    await tx.agentPrompt.updateMany({
      where: whereClause,
      data: { isDefault: false },
    });
    // Set new default
    return tx.agentPrompt.update({
      where: { id: promptId },
      data: { isDefault: true },
    });
  });
  revalidatePath("/workspaces");
  revalidatePath("/settings");
  return prompt;
}
```

### i18n Keys to Add
```typescript
// In src/lib/i18n.tsx translations
"settings.prompts.title": "提示词管理",
"settings.prompts.title": "Prompt Management",
"settings.prompts.newPrompt": "新建提示词",
"settings.prompts.newPrompt": "New Prompt",
"settings.prompts.editPrompt": "编辑提示词",
"settings.prompts.editPrompt": "Edit Prompt",
"settings.prompts.promptName": "名称",
"settings.prompts.promptName": "Name",
"settings.prompts.promptNamePlaceholder": "输入提示词名称",
"settings.prompts.promptNamePlaceholder": "Enter prompt name",
"settings.prompts.promptDescription": "描述",
"settings.prompts.promptDescription": "Description",
"settings.prompts.promptDescriptionPlaceholder": "可选，简要描述用途",
"settings.prompts.promptDescriptionPlaceholder": "Optional, brief description",
"settings.prompts.promptContent": "内容",
"settings.prompts.promptContent": "Content",
"settings.prompts.promptContentPlaceholder": "输入提示词内容...",
"settings.prompts.promptContentPlaceholder": "Enter prompt content...",
"settings.prompts.deleteConfirmTitle": "确认删除",
"settings.prompts.deleteConfirmTitle": "Confirm Delete",
"settings.prompts.deleteConfirmMessage": "删除后无法恢复。",
"settings.prompts.deleteConfirmMessage": "This cannot be undone.",
"settings.prompts.setDefault": "设为默认",
"settings.prompts.setDefault": "Set as Default",
"settings.prompts.default": "默认",
"settings.prompts.default": "Default",
"settings.prompts.empty": "暂无提示词",
"settings.prompts.empty": "No prompts yet",
"settings.prompts.emptyHint": "点击上方按钮创建第一个提示词",
"settings.prompts.emptyHint": "Click the button above to create your first prompt",
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `updatePrompt` accepts `isDefault` without clearing others | `setDefaultPrompt` uses `$transaction` to clear + set atomically | This phase | Fixes isDefault exclusivity invariant |

**No deprecated patterns in this domain.**

## Open Questions

1. **Can a user remove the default status entirely?**
   - What we know: Schema has `isDefault: Boolean @default(false)`. No prompt starts as default.
   - What's unclear: If user un-checks the default, should any prompt be default? Or must exactly one always be default?
   - Recommendation: Allow unsetting. After unsetting, no prompt is default. `setDefaultPrompt` should set `isDefault: true` only; not touching other prompts if the new value is `false`.

2. **Should creating a new prompt automatically make it default?**
   - What we know: `createPrompt` accepts `isDefault` parameter.
   - What's unclear: Is the new prompt default by default when created?
   - Recommendation: No -- new prompts are not default by default. User must explicitly set as default after creation.

3. **Should there be a workspace filter on the prompts list?**
   - What we know: `getPrompts(workspaceId?)` can filter by workspace. Current settings are global.
   - What's unclear: Should the prompts settings show all prompts or only current workspace's?
   - Recommendation: Show all prompts (global settings). Per REQ-05, list all prompts with name, description, default indicator. Workspace filtering deferred per REQUIREMENTS.md out-of-scope note.

## Environment Availability

> Step 2.6: SKIPPED (no external dependencies identified)

This phase is purely code/config changes. All required tools are already present in the project:
- Prisma (already in use for data layer)
- shadcn/ui components (already in `src/components/ui/`)
- Next.js App Router server actions (already in use)
- i18n system (already in use)

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None (no existing test infrastructure in project) |
| Config file | — |
| Quick run command | — |
| Full suite command | — |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PMPT-01 | Create new prompt with name/description/content | Manual | — | N/A |
| PMPT-02 | Edit existing prompt | Manual | — | N/A |
| PMPT-03 | Delete prompt with confirmation | Manual | — | N/A |
| PMPT-04 | Set prompt as default | Manual | — | N/A |
| PMPT-05 | Prompt list shows name/description/default indicator | Manual | — | N/A |

**Note:** No automated test infrastructure exists in this project. All verification is manual UI testing. Wave 0 gaps are N/A.

## Sources

### Primary (HIGH confidence)
- `src/actions/prompt-actions.ts` — existing CRUD server actions, confirmed `updatePrompt` does not handle isDefault transactionally
- `prisma/schema.prisma` — `AgentPrompt` model with `isDefault: Boolean @default(false)`
- `src/components/ui/dialog.tsx` — Dialog API using `@base-ui/react/dialog`
- `src/components/settings/ai-tools-config.tsx` — settings panel pattern reference
- `src/components/settings/general-config.tsx` — simpler settings panel pattern reference

### Secondary (MEDIUM confidence)
- `src/lib/i18n.tsx` — i18n key pattern and existing translation structure
- `src/components/settings/cli-adapter-tester.tsx` — loading state, dialog patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — only existing shadcn/ui components, no new libraries needed
- Architecture: HIGH — clear component + server action separation, transaction pattern straightforward
- Pitfalls: MEDIUM — isDefault transaction is a known concern (documented in STATE.md), others are common patterns

**Research date:** 2026-03-26
**Valid until:** 2026-04-25 (30 days, stable domain)
