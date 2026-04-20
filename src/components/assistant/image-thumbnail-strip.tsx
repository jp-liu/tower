"use client";

import { AlertCircle, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { PendingImage } from "@/hooks/use-image-upload";

interface ImageThumbnailStripProps {
  pendingImages: PendingImage[];
  onRemove: (id: string) => void;
  onPreview: (image: PendingImage) => void;
}

export function ImageThumbnailStrip({
  pendingImages,
  onRemove,
  onPreview,
}: ImageThumbnailStripProps) {
  const { t } = useI18n();

  if (pendingImages.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-row gap-2 px-4 pt-2 pb-0">
      {pendingImages.map((image) => (
        <div
          key={image.id}
          className={`relative h-12 w-12 shrink-0 rounded-md overflow-hidden ring-1 ${
            image.status === "error" ? "ring-destructive" : "ring-border"
          }`}
        >
          {/* Thumbnail image — clickable for preview */}
          <button
            type="button"
            className={`h-full w-full p-0 border-0 bg-transparent ${
              image.status === "uploading" ? "cursor-wait" : "cursor-pointer"
            }`}
            disabled={image.status === "uploading"}
            aria-label={t("assistant.previewImage")}
            onClick={() => onPreview(image)}
          >
            <img
              src={image.blobUrl}
              className="h-full w-full object-cover"
              alt=""
            />
          </button>

          {/* Progress overlay — visible while status === "uploading" */}
          {image.status === "uploading" && (
            <div className="absolute inset-0 flex flex-col justify-end bg-black/30">
              <div
                role="progressbar"
                aria-valuenow={image.progress}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-1 bg-primary transition-all duration-150"
                style={{ width: `${image.progress}%` }}
              />
              <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-white">
                {image.progress}%
              </span>
            </div>
          )}

          {/* Error overlay — visible when status === "error" */}
          {image.status === "error" && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
              <AlertCircle className="h-4 w-4 text-white" />
            </div>
          )}

          {/* X remove button — always visible */}
          <button
            className="absolute top-1 right-1 h-4 w-4 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors"
            aria-label={t("assistant.removeImage")}
            title={
              image.status === "error"
                ? t("assistant.uploadFailedRemoveHint")
                : undefined
            }
            onClick={(e) => {
              e.stopPropagation();
              onRemove(image.id);
            }}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
