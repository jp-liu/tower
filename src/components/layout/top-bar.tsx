"use client";

import Link from "next/link";
import { Search, Settings, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export function TopBar() {
  return (
    <header className="flex h-14 items-center justify-between border-b bg-white px-6">
      {/* Left spacer for breadcrumb area */}
      <div className="w-48" />

      {/* Search */}
      <div className="relative w-80">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search tasks..."
          className="pl-9 h-9 bg-gray-50 border-gray-200"
        />
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-3">
        <Link href="/settings" className="rounded-lg p-2 text-gray-500 hover:bg-gray-100">
          <Settings className="h-5 w-5" />
        </Link>
        <Button size="sm" className="bg-violet-600 hover:bg-violet-700 text-white gap-1.5">
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
  );
}
