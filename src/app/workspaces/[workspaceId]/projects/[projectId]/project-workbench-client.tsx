"use client";

import { useState } from "react";
import { ArrowLeft, FolderTree, Search, GitPullRequestArrow, Eye } from "lucide-react";
import Link from "next/link";
import { Panel, PanelGroup } from "react-resizable-panels";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FileTree } from "@/components/task/file-tree";
import { CodeEditor, type DiffFileRequest } from "@/components/task/code-editor";
import { CodeSearch } from "@/components/task/code-search";
import { EditorGitPanel } from "@/components/task/editor-git-panel";
import { PreviewPanel } from "@/components/task/preview-panel";
import { useI18n } from "@/lib/i18n";

interface ProjectWorkbenchClientProps {
  project: {
    id: string;
    name: string;
    alias: string | null;
    type: string;
    localPath: string | null;
    gitUrl: string | null;
    projectType: string | null;
    previewCommand: string | null;
    previewPort: number | null;
  };
  workspaceId: string;
  workspaceName: string;
}

export function ProjectWorkbenchClient({
  project,
  workspaceId,
  workspaceName,
}: ProjectWorkbenchClientProps) {
  const { t } = useI18n();
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [diffFileRequest, setDiffFileRequest] = useState<DiffFileRequest | null>(null);
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const [previewUrl, setPreviewUrl] = useState("");

  const localPath = project.localPath;

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3 shrink-0">
        <Link
          href={`/workspaces/${workspaceId}?projectId=${project.id}`}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm text-muted-foreground truncate">{workspaceName}</span>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm font-semibold text-foreground truncate">{project.name}-Tower</span>
        </div>
      </div>

      {/* Main content */}
      <PanelGroup direction="horizontal" className="flex-1 min-h-0">
        {/* Editor panel */}
        <Panel defaultSize={100} minSize={30} className="flex flex-col">
          <Tabs defaultValue="files" className="flex h-full flex-col gap-0">
            <div className="flex shrink-0 items-center border-b border-border px-3 py-3">
              <TabsList className="h-auto border border-border">
                <TabsTrigger value="files" className="data-active:bg-background data-active:text-foreground data-active:shadow-sm dark:data-active:bg-background dark:data-active:border-transparent">
                  <FolderTree className="h-3.5 w-3.5" />
                  {t("taskPage.tabFiles")}
                </TabsTrigger>
                {project.projectType !== "BACKEND" && (
                  <TabsTrigger value="preview" className="data-active:bg-background data-active:text-foreground data-active:shadow-sm dark:data-active:bg-background dark:data-active:border-transparent">
                    <Eye className="h-3.5 w-3.5" />
                    {t("taskPage.tabPreview")}
                  </TabsTrigger>
                )}
              </TabsList>
            </div>

            {/* Files tab */}
            <TabsContent value="files" className="flex-1 min-h-0 overflow-hidden">
              <div className="flex h-full flex-row overflow-hidden">
                {/* Left: sub-tabs */}
                <div className="w-60 flex-none border-r border-border overflow-hidden flex flex-col">
                  <Tabs defaultValue="filetree" className="flex h-full flex-col gap-0">
                    <div className="flex shrink-0 border-b border-border px-2 py-1.5">
                      <TabsList className="h-auto border border-border w-full">
                        <TabsTrigger value="filetree" className="flex-1 text-xs gap-1 data-active:bg-background data-active:text-foreground data-active:shadow-sm dark:data-active:bg-background dark:data-active:border-transparent">
                          <FolderTree className="h-3 w-3" />
                          {t("taskPage.tabFileTree")}
                        </TabsTrigger>
                        <TabsTrigger value="search" className="flex-1 text-xs gap-1 data-active:bg-background data-active:text-foreground data-active:shadow-sm dark:data-active:bg-background dark:data-active:border-transparent">
                          <Search className="h-3 w-3" />
                          {t("taskPage.tabSearch")}
                        </TabsTrigger>
                        <TabsTrigger value="git" className="flex-1 text-xs gap-1 data-active:bg-background data-active:text-foreground data-active:shadow-sm dark:data-active:bg-background dark:data-active:border-transparent">
                          <GitPullRequestArrow className="h-3 w-3" />
                          {t("git.tabLabel")}
                        </TabsTrigger>
                      </TabsList>
                    </div>
                    <TabsContent value="filetree" className="flex-1 min-h-0 overflow-hidden mt-0">
                      <FileTree
                        worktreePath={localPath}
                        baseBranch={null}
                        worktreeBranch={null}
                        executionStatus="COMPLETED"
                        onFileSelect={(absolutePath) => {
                          setSelectedFilePath(absolutePath);
                          setSelectedLine(null);
                        }}
                      />
                    </TabsContent>
                    <TabsContent value="search" className="flex-1 min-h-0 overflow-hidden mt-0">
                      <CodeSearch
                        localPath={localPath}
                        onResultSelect={(absolutePath, line) => {
                          setSelectedFilePath(absolutePath);
                          setSelectedLine(line);
                        }}
                      />
                    </TabsContent>
                    <TabsContent value="git" className="flex-1 min-h-0 overflow-hidden mt-0">
                      <EditorGitPanel
                        localPath={localPath ?? ""}
                        onFileSelect={(relativePath, originalContent) => {
                          setDiffFileRequest({ relativePath, originalContent });
                        }}
                      />
                    </TabsContent>
                  </Tabs>
                </div>
                {/* Right: Editor */}
                <div className="flex-1 min-w-0 overflow-hidden">
                  {localPath ? (
                    <CodeEditor
                      worktreePath={localPath}
                      selectedFilePath={selectedFilePath}
                      selectedLine={selectedLine}
                      onFilePathChange={setSelectedFilePath}
                      onSave={() => setPreviewRefreshKey((k) => k + 1)}
                      diffFileRequest={diffFileRequest}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <p className="text-sm text-muted-foreground">{t("git.noLocalPath")}</p>
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>

            {/* Preview tab */}
            <TabsContent value="preview" className="flex-1 min-h-0 overflow-hidden">
              <PreviewPanel
                taskId={`project-${project.id}`}
                worktreePath={localPath}
                previewCommand={project.previewCommand}
                previewPort={project.previewPort}
                refreshKey={previewRefreshKey}
                projectId={project.id}
                previewUrl={previewUrl}
                onPreviewUrlChange={setPreviewUrl}
              />
            </TabsContent>
          </Tabs>
        </Panel>
      </PanelGroup>
    </div>
  );
}
