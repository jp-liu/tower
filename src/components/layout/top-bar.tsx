"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search, Settings, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { searchTasks } from "@/actions/task-actions";

interface SearchResult {
  id: string;
  title: string;
  projectId: string;
  project: {
    name: string;
    workspaceId: string;
    workspace: { name: string };
  };
}

interface TopBarProps {
  onCreateProject?: (name: string) => void;
}

export function TopBar({ onCreateProject }: TopBarProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [projectName, setProjectName] = useState("");
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Debounced search
  useEffect(() => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }

    if (!searchQuery.trim()) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }

    searchTimerRef.current = setTimeout(async () => {
      const results = await searchTasks(searchQuery);
      setSearchResults(results as SearchResult[]);
      setShowResults(true);
    }, 300);

    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, [searchQuery]);

  // Click outside to close results
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleCreateProject = () => {
    if (projectName.trim()) {
      onCreateProject?.(projectName.trim());
      setProjectName("");
      setShowNewProject(false);
    }
  };

  return (
    <>
      <header className="flex h-14 items-center justify-between border-b bg-white px-6">
        <div className="w-48" />

        <div ref={searchContainerRef} className="relative w-80">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search tasks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => {
              if (searchResults.length > 0) setShowResults(true);
            }}
            className="pl-9 h-9 bg-gray-50 border-gray-200"
          />
          {showResults && searchResults.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-lg border bg-white shadow-lg max-h-80 overflow-auto">
              {searchResults.map((task) => (
                <button
                  key={task.id}
                  onClick={() => {
                    router.push(`/workspaces/${task.project.workspaceId}?projectId=${task.projectId}`);
                    setSearchQuery("");
                    setShowResults(false);
                  }}
                  className="flex w-full flex-col px-4 py-2.5 text-left hover:bg-gray-50 border-b last:border-b-0"
                >
                  <span className="text-sm font-medium text-gray-900">{task.title}</span>
                  <span className="text-xs text-gray-500">
                    {task.project.workspace.name} / {task.project.name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Link href="/settings" className="rounded-lg p-2 text-gray-500 hover:bg-gray-100">
            <Settings className="h-5 w-5" />
          </Link>
          <Button
            size="sm"
            className="bg-violet-600 hover:bg-violet-700 text-white gap-1.5"
            onClick={() => setShowNewProject(true)}
          >
            <Plus className="h-4 w-4" />
            新建项目
          </Button>
          <div className="flex items-center gap-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-green-500 text-white text-xs">
                JP
              </AvatarFallback>
            </Avatar>
            <span className="text-sm text-gray-700">jpliu6</span>
          </div>
        </div>
      </header>

      <Dialog open={showNewProject} onOpenChange={setShowNewProject}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新建项目</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="输入项目名称"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateProject()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewProject(false)}>
              取消
            </Button>
            <Button
              onClick={handleCreateProject}
              className="bg-violet-600 hover:bg-violet-700"
            >
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
