"use client";

import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { gitAction } from "@/lib/git-api";
import type { RawCommit } from "@/lib/git-graph-layout";
import { CommitTagDialog } from "./commit-tag-dialog";
import { CommitMessageDialog } from "./commit-message-dialog";

// NOTE: "Create branch from here" is intentionally omitted in v1.3.1
// because CreateBranchDialog does not accept a baseHash prop.
// Wire this in v1.4 by extending CreateBranchDialogProps with baseHash.

export interface CommitActionMenuProps {
  worktreePath: string;
  commit: RawCommit;
  currentHead: string | null;
  onActionComplete?: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Position for right-click mode. When provided, menu opens at this absolute (x, y). */
  anchorPosition?: { x: number; y: number };
  /** Custom trigger element (e.g. the ⋯ Button) for click-anchored mode. */
  triggerElement?: React.ReactNode;
}

export function CommitActionMenu({
  worktreePath,
  commit,
  currentHead,
  onActionComplete,
  open,
  onOpenChange,
  anchorPosition,
  triggerElement,
}: CommitActionMenuProps) {
  const { t } = useI18n();
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [amendDialogOpen, setAmendDialogOpen] = useState(false);

  const isHead = commit.hash === currentHead;

  const safeAction = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      toast.success(label);
      onActionComplete?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleCheckout = () =>
    safeAction(t("git.commitMenuCheckout"), () =>
      gitAction(worktreePath, "checkout-commit", { hash: commit.hash })
    );

  const handleResetSoft = () =>
    safeAction(t("git.commitMenuResetSoft"), () =>
      gitAction(worktreePath, "reset-commit", { hash: commit.hash, mode: "soft" })
    );

  const handleResetMixed = () =>
    safeAction(t("git.commitMenuResetMixed"), () =>
      gitAction(worktreePath, "reset-commit", { hash: commit.hash, mode: "mixed" })
    );

  const handleResetHard = () => {
    const confirmMsg = t("git.commitResetHardConfirm").replace(
      "{subject}",
      commit.subject
    );
    if (!confirm(confirmMsg)) return;
    safeAction(t("git.commitMenuResetHard"), () =>
      gitAction(worktreePath, "reset-commit", { hash: commit.hash, mode: "hard" })
    );
  };

  const handleCherryPick = () =>
    safeAction(t("git.commitMenuCherryPick"), () =>
      gitAction(worktreePath, "cherry-pick", { hash: commit.hash })
    );

  const handleRevert = () =>
    safeAction(t("git.commitMenuRevert"), () =>
      gitAction(worktreePath, "revert", { hash: commit.hash })
    );

  const handleCopyHash = () => {
    try {
      navigator.clipboard.writeText(commit.hash);
    } catch {
      // clipboard API unavailable — silently skip
    }
    toast.success(t("git.commitMenuCopyHash"));
    onOpenChange(false);
  };

  const handleCopyShort = () => {
    try {
      navigator.clipboard.writeText(commit.shortHash);
    } catch {
      // clipboard API unavailable — silently skip
    }
    toast.success(t("git.commitMenuCopyShort"));
    onOpenChange(false);
  };

  return (
    <>
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        {triggerElement ? (
          <DropdownMenuTrigger render={triggerElement as React.ReactElement} />
        ) : anchorPosition ? (
          <DropdownMenuTrigger
            style={{
              position: "fixed",
              left: anchorPosition.x,
              top: anchorPosition.y,
              width: 0,
              height: 0,
              pointerEvents: "none",
            }}
            aria-hidden
          />
        ) : null}

        <DropdownMenuContent
          align="start"
          className="w-56"
          data-testid="commit-action-menu"
        >
          <DropdownMenuItem onClick={handleCheckout}>
            {t("git.commitMenuCheckout")}
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => {
              setTagDialogOpen(true);
              onOpenChange(false);
            }}
          >
            {t("git.commitMenuCreateTag")}
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={handleCherryPick}>
            {t("git.commitMenuCherryPick")}
          </DropdownMenuItem>

          <DropdownMenuItem onClick={handleRevert}>
            {t("git.commitMenuRevert")}
          </DropdownMenuItem>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              {t("git.commitMenuReset")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={handleResetSoft}>
                {t("git.commitMenuResetSoft")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleResetMixed}>
                {t("git.commitMenuResetMixed")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleResetHard}
                className="text-destructive"
              >
                {t("git.commitMenuResetHard")}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={() => {
              setAmendDialogOpen(true);
              onOpenChange(false);
            }}
            disabled={!isHead}
            data-testid="amend-menu-item"
          >
            {t("git.commitMenuAmend")}
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={handleCopyHash}>
            {t("git.commitMenuCopyHash")}
          </DropdownMenuItem>

          <DropdownMenuItem onClick={handleCopyShort}>
            {t("git.commitMenuCopyShort")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Create tag */}
      <CommitTagDialog
        open={tagDialogOpen}
        onOpenChange={setTagDialogOpen}
        worktreePath={worktreePath}
        commitHash={commit.hash}
        onCreated={() => onActionComplete?.()}
      />

      {/* Amend message */}
      <CommitMessageDialog
        open={amendDialogOpen}
        onOpenChange={setAmendDialogOpen}
        worktreePath={worktreePath}
        initialMessage={commit.subject}
        onSubmitted={() => onActionComplete?.()}
      />
    </>
  );
}
