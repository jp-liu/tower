"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  classifyAttachmentExt,
  type AttachmentKind,
} from "@/lib/attachment-utils";

export interface PendingAttachment {
  id: string;
  file: File;
  /** Object URL — only populated for image kind (used in thumbnails). */
  blobUrl: string | null;
  kind: AttachmentKind;
  status: "uploading" | "done" | "error";
  progress: number; // 0-100
  filename?: string; // server sub-path, populated after successful upload
}

const UPLOAD_ENDPOINT = "/api/internal/assistant/attachments";

function fileExt(file: File): string {
  const dotIdx = file.name.lastIndexOf(".");
  return dotIdx >= 0 ? file.name.slice(dotIdx) : "";
}

export function useAttachmentUpload() {
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const xhrMap = useRef<Map<string, XMLHttpRequest>>(new Map());
  const itemsRef = useRef<PendingAttachment[]>([]);

  useEffect(() => {
    itemsRef.current = pendingAttachments;
  }, [pendingAttachments]);

  // Cleanup on unmount: revoke blob URLs and abort in-flight XHRs
  useEffect(() => {
    const requests = xhrMap.current;
    return () => {
      itemsRef.current.forEach((it) => {
        if (it.blobUrl) URL.revokeObjectURL(it.blobUrl);
      });
      requests.forEach((xhr) => xhr.abort());
      requests.clear();
    };
  }, []);

  const addAttachments = useCallback((files: File[]) => {
    // Filter out unsupported types upfront so the UI doesn't show a doomed entry
    const accepted: PendingAttachment[] = [];
    for (const file of files) {
      const kind = classifyAttachmentExt(fileExt(file));
      if (!kind) continue;
      accepted.push({
        id: crypto.randomUUID(),
        file,
        kind,
        blobUrl: kind === "image" ? URL.createObjectURL(file) : null,
        status: "uploading",
        progress: 0,
      });
    }
    if (accepted.length === 0) return;

    itemsRef.current = [...itemsRef.current, ...accepted];
    setPendingAttachments((prev) => [...prev, ...accepted]);

    for (const item of accepted) {
      const xhr = new XMLHttpRequest();
      xhrMap.current.set(item.id, xhr);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const progress = Math.round((e.loaded / e.total) * 100);
          setPendingAttachments((prev) =>
            prev.map((it) => (it.id === item.id ? { ...it, progress } : it))
          );
        }
      };

      xhr.onload = () => {
        xhrMap.current.delete(item.id);
        if (xhr.status === 200) {
          try {
            const data = JSON.parse(xhr.responseText) as { filename?: unknown };
            const filename =
              typeof data.filename === "string" && data.filename ? data.filename : null;
            if (!filename) throw new Error("Invalid upload response");
            setPendingAttachments((prev) =>
              prev.map((it) =>
                it.id === item.id
                  ? { ...it, status: "done", progress: 100, filename }
                  : it
              )
            );
          } catch {
            setPendingAttachments((prev) =>
              prev.map((it) =>
                it.id === item.id ? { ...it, status: "error" } : it
              )
            );
          }
        } else {
          setPendingAttachments((prev) =>
            prev.map((it) =>
              it.id === item.id ? { ...it, status: "error" } : it
            )
          );
        }
      };

      xhr.onerror = () => {
        xhrMap.current.delete(item.id);
        setPendingAttachments((prev) =>
          prev.map((it) => (it.id === item.id ? { ...it, status: "error" } : it))
        );
      };

      const formData = new FormData();
      formData.append("file", item.file);
      xhr.open("POST", UPLOAD_ENDPOINT);
      xhr.send(formData);
    }
  }, []);

  const removeAttachment = useCallback((id: string) => {
    const xhr = xhrMap.current.get(id);
    if (xhr) {
      xhr.abort();
      xhrMap.current.delete(id);
    }
    setPendingAttachments((prev) => {
      const it = prev.find((i) => i.id === id);
      if (it?.blobUrl) URL.revokeObjectURL(it.blobUrl);
      return prev.filter((i) => i.id !== id);
    });
  }, []);

  const clearAll = useCallback(() => {
    setPendingAttachments((prev) => {
      prev.forEach((it) => {
        const xhr = xhrMap.current.get(it.id);
        if (xhr) {
          xhr.abort();
          xhrMap.current.delete(it.id);
        }
        if (it.blobUrl) URL.revokeObjectURL(it.blobUrl);
      });
      xhrMap.current.clear();
      return [];
    });
  }, []);

  const hasUploading = pendingAttachments.some((i) => i.status === "uploading");

  return {
    pendingAttachments,
    addAttachments,
    removeAttachment,
    clearAll,
    hasUploading,
  };
}
