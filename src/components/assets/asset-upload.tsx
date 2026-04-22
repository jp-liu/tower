"use client";

import { useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import { uploadAsset } from "@/actions/asset-actions";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";

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

interface AssetUploadProps {
  allWorkspaces: SimpleWorkspace[];
  initialWsId: string;
  initialProjectId: string | null;
  onUploaded: (projectId: string) => void;
}

export function AssetUpload({
  allWorkspaces,
  initialWsId,
  initialProjectId,
  onUploaded,
}: AssetUploadProps) {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadWsId, setUploadWsId] = useState(initialWsId);
  const [uploadProjectId, setUploadProjectId] = useState<string | null>(initialProjectId);
  const [description, setDescription] = useState("");

  const uploadWs = allWorkspaces.find((ws) => ws.id === uploadWsId);
  const uploadProjects = uploadWs?.projects ?? [];

  const handleOpen = () => {
    setUploadWsId(initialWsId);
    setUploadProjectId(initialProjectId);
    setSelectedFile(null);
    setDescription("");
    setIsOpen(true);
  };

  const handleClose = () => {
    setIsOpen(false);
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleWsChange = (wsId: string) => {
    setUploadWsId(wsId);
    const ws = allWorkspaces.find((w) => w.id === wsId);
    setUploadProjectId(ws?.projects[0]?.id ?? null);
  };

  const handleFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedFile(e.target.files?.[0] ?? null);
  };

  const handleUpload = async () => {
    if (!selectedFile || !uploadProjectId) return;
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("projectId", uploadProjectId);
      formData.append("description", description.trim());
      await uploadAsset(formData);
      onUploaded(uploadProjectId);
      handleClose();
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <>
      <Button
        onClick={handleOpen}
        className="bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/25 hover:bg-amber-500/25"
      >
        <Upload className="h-3.5 w-3.5" />
        <span>{t("assets.upload")}</span>
      </Button>

      {/* Upload dialog */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50" onClick={handleClose} />
          {/* Dialog */}
          <div className="relative w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg">
            {/* Close button */}
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={handleClose}
              className="absolute right-3 top-3 text-muted-foreground"
            >
              <X className="h-4 w-4" />
            </Button>

            <h3 className="text-sm font-semibold text-foreground mb-4">{t("assets.uploadTitle")}</h3>

            <div className="space-y-4">
              {/* Workspace */}
              <div className="flex items-center gap-3">
                <label className="text-xs text-muted-foreground w-16 shrink-0">{t("assets.workspace")}</label>
                <Select value={uploadWsId} onValueChange={(v) => handleWsChange(v ?? "")}>
                  <SelectTrigger className="flex-1 text-xs">
                    <span className="truncate">{uploadWs?.name ?? uploadWsId}</span>
                  </SelectTrigger>
                  <SelectContent>
                    {allWorkspaces.map((ws) => (
                      <SelectItem key={ws.id} value={ws.id}>{ws.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Project */}
              <div className="flex items-center gap-3">
                <label className="text-xs text-muted-foreground w-16 shrink-0">{t("assets.project")}</label>
                {uploadProjects.length > 0 ? (
                  <Select value={uploadProjectId ?? ""} onValueChange={(v: string | null) => setUploadProjectId(v ?? "")}>
                    <SelectTrigger className="flex-1 text-xs">
                      <span className="truncate">
                        {(() => { const p = uploadProjects.find((x) => x.id === uploadProjectId); return p ? (p.alias ? `${p.name} (${p.alias})` : p.name) : uploadProjectId; })()}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {uploadProjects.map((p) => {
                        const display = p.alias ? `${p.name} (${p.alias})` : p.name;
                        return (
                          <SelectItem key={p.id} value={p.id}>
                            {display}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="text-xs text-muted-foreground">{t("assets.noProject")}</span>
                )}
              </div>

              {/* File */}
              <div className="flex items-center gap-3">
                <label className="text-xs text-muted-foreground w-16 shrink-0">{t("assets.file")}</label>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  className="hidden"
                />
                <button
                  onClick={handleFileSelect}
                  className="flex-1 rounded-md border border-dashed border-border bg-background px-3 py-2 text-xs text-muted-foreground hover:border-amber-500/50 hover:text-foreground transition-colors text-left"
                >
                  {selectedFile ? selectedFile.name : t("assets.selectFile")}
                </button>
              </div>

              {/* Description */}
              <div className="flex items-start gap-3">
                <label className="text-xs text-muted-foreground w-16 shrink-0 pt-1.5">
                  {t("assets.description")}
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("assets.descriptionPlaceholder")}
                  className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/50 resize-none h-20"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 justify-end mt-6">
              <Button
                variant="outline"
                onClick={handleClose}
              >
                {t("notes.cancel")}
              </Button>
              <Button
                onClick={handleUpload}
                disabled={!selectedFile || !uploadProjectId || !description.trim() || isUploading}
                className="bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/25 hover:bg-amber-500/25"
              >
                {isUploading ? t("assets.uploading") : t("assets.upload")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
