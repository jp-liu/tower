"use client";

import { useState, useRef, useEffect, useCallback } from "react";

export interface PendingImage {
  id: string;
  file: File;
  blobUrl: string;
  status: "uploading" | "done" | "error";
  progress: number; // 0-100
  filename?: string; // populated after successful upload
}

export function useImageUpload() {
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const xhrMap = useRef<Map<string, XMLHttpRequest>>(new Map());
  const imagesRef = useRef<PendingImage[]>([]);

  // Keep imagesRef in sync for cleanup
  useEffect(() => {
    imagesRef.current = pendingImages;
  }, [pendingImages]);

  // Cleanup on unmount: revoke all blob URLs and abort in-flight XHRs
  useEffect(() => {
    return () => {
      imagesRef.current.forEach((img) => URL.revokeObjectURL(img.blobUrl));
      xhrMap.current.forEach((xhr) => xhr.abort());
      xhrMap.current.clear();
    };
  }, []);

  const addImages = useCallback((files: File[]) => {
    const newImages: PendingImage[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      blobUrl: URL.createObjectURL(file),
      status: "uploading",
      progress: 0,
    }));

    // Sync ref immediately so unmount cleanup can revoke these blob URLs
    imagesRef.current = [...imagesRef.current, ...newImages];
    setPendingImages((prev) => [...prev, ...newImages]);

    for (const image of newImages) {
      const xhr = new XMLHttpRequest();
      xhrMap.current.set(image.id, xhr);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const progress = Math.round((e.loaded / e.total) * 100);
          setPendingImages((prev) =>
            prev.map((img) =>
              img.id === image.id ? { ...img, progress } : img
            )
          );
        }
      };

      xhr.onload = () => {
        xhrMap.current.delete(image.id);
        if (xhr.status === 200) {
          try {
            const data = JSON.parse(xhr.responseText) as { filename?: unknown };
            const filename = typeof data.filename === "string" && data.filename ? data.filename : null;
            if (!filename) throw new Error("Invalid upload response");
            setPendingImages((prev) =>
              prev.map((img) =>
                img.id === image.id
                  ? { ...img, status: "done", progress: 100, filename }
                  : img
              )
            );
          } catch {
            setPendingImages((prev) =>
              prev.map((img) =>
                img.id === image.id ? { ...img, status: "error" } : img
              )
            );
          }
        } else {
          setPendingImages((prev) =>
            prev.map((img) =>
              img.id === image.id ? { ...img, status: "error" } : img
            )
          );
        }
      };

      xhr.onerror = () => {
        xhrMap.current.delete(image.id);
        setPendingImages((prev) =>
          prev.map((img) =>
            img.id === image.id ? { ...img, status: "error" } : img
          )
        );
      };

      const formData = new FormData();
      formData.append("file", image.file);
      xhr.open("POST", "/api/internal/assistant/images");
      xhr.send(formData);
    }
  }, []);

  const removeImage = useCallback((id: string) => {
    const xhr = xhrMap.current.get(id);
    if (xhr) {
      xhr.abort();
      xhrMap.current.delete(id);
    }
    setPendingImages((prev) => {
      const img = prev.find((i) => i.id === id);
      if (img) {
        URL.revokeObjectURL(img.blobUrl);
      }
      return prev.filter((i) => i.id !== id);
    });
  }, []);

  const clearAll = useCallback(() => {
    setPendingImages((prev) => {
      prev.forEach((img) => {
        const xhr = xhrMap.current.get(img.id);
        if (xhr) {
          xhr.abort();
          xhrMap.current.delete(img.id);
        }
        URL.revokeObjectURL(img.blobUrl);
      });
      xhrMap.current.clear();
      return [];
    });
  }, []);

  const hasUploading = pendingImages.some((i) => i.status === "uploading");

  return { pendingImages, addImages, removeImage, clearAll, hasUploading };
}
