"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { uploadAsset } from "@/actions/asset-actions";
import { useI18n } from "@/lib/i18n";

interface AssetUploadProps {
  projectId: string;
  onUploaded: () => void;
}

export function AssetUpload({ projectId, onUploaded }: AssetUploadProps) {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("projectId", projectId);
      await uploadAsset(formData);
      onUploaded();
    } finally {
      setIsUploading(false);
      // Reset file input so same file can be re-uploaded
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        aria-label={t("assets.upload")}
      />
      <button
        onClick={handleClick}
        disabled={isUploading}
        className="flex items-center gap-1.5 rounded-md bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-300 ring-1 ring-amber-500/25 hover:bg-amber-500/25 disabled:opacity-50 transition-colors"
      >
        <Upload className="h-3.5 w-3.5" />
        <span>{isUploading ? t("assets.uploading") : t("assets.upload")}</span>
      </button>
    </div>
  );
}
