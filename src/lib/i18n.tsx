"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type Locale = "zh" | "en";

// All translations for the app
const translations = {
  zh: {
    // Sidebar
    "sidebar.workspace": "工作空间",
    "sidebar.newWorkspace": "新建工作空间",
    "sidebar.collapse": "折叠侧边栏",
    "sidebar.expand": "展开侧边栏",
    "sidebar.rename": "重命名",
    "sidebar.delete": "删除",
    "sidebar.archive": "归档",
    "sidebar.manageLabels": "管理标签",
    "sidebar.deleteConfirm": "确认删除工作空间「{name}」？所有项目和任务将被删除。",
    "sidebar.settings": "配置",
    // Workspace dialog
    "workspace.create": "新建工作空间",
    "workspace.edit": "编辑工作空间",
    "workspace.name": "名称",
    "workspace.namePlaceholder": "输入工作空间名称",
    "workspace.icon": "图标",
    // Common
    "common.cancel": "取消",
    "common.create": "创建",
    "common.save": "保存",
    "common.delete": "删除",
    "common.add": "添加",
    "common.edit": "编辑",
    "common.search": "搜索",
    // Top bar
    "topbar.newProject": "新建项目",
    "topbar.searchPlaceholder": "搜索任务、项目、仓库...",
    // Project creation
    "project.name": "项目名称",
    "project.alias": "项目别名",
    "project.description": "项目描述",
    "project.normalType": "普通项目",
    "project.gitType": "Git 项目",
    "project.gitUrl": "Git 仓库地址",
    "project.namePlaceholder": "输入项目名称",
    "project.aliasPlaceholder": "可选，如：前端重构",
    "project.descPlaceholder": "可选，项目简介",
    "project.gitPlaceholder": "https://github.com/...",
    "project.localPath": "本地路径",
    "project.localPathPlaceholder": "/Users/you/projects/my-app",
    "project.localPathHint": "项目在本地磁盘的文件夹路径",
    "project.edit": "编辑项目",
    // Board
    "board.kanban": "任务看板",
    "board.overview": "概览",
    "board.running": "执行中",
    "board.tip": "提示",
    "board.newTask": "新建任务",
    "board.allFilter": "全部",
    "board.inProgressFilter": "执行中",
    "board.inReviewFilter": "待评审",
    // Task
    "task.create": "新建任务",
    "task.edit": "编辑任务",
    "task.title": "任务标题",
    "task.titlePlaceholder": "输入任务标题",
    "task.description": "描述",
    "task.descPlaceholder": "输入任务描述 (支持 Markdown)",
    "task.priority": "优先级",
    "task.labels": "标签",
    "task.priorityLow": "低",
    "task.priorityMedium": "中",
    "task.priorityHigh": "高",
    "task.priorityCritical": "紧急",
    // Task detail
    "taskDetail.title": "任务对话",
    "taskDetail.back": "返回任务列表",
    "taskDetail.hasConversation": "已有会话",
    "taskDetail.updatedAt": "更新于",
    "taskDetail.send": "发送",
    "taskDetail.sending": "处理中...",
    "taskDetail.inputPlaceholder": "输入指令...",
    "taskDetail.emptyState": "开始对话，让 AI 代理执行任务",
    "taskDetail.emptyHint": "输入指令后按 Enter 发送",
    "taskDetail.sendFailed": "发送失败，请重试",
    "taskDetail.filesChanged": "个文件已更改",
    // Search
    "search.placeholder": "搜索任务、项目、仓库...",
    "search.task": "任务",
    "search.project": "项目",
    "search.repository": "仓库",
    "search.noResults": "没有找到结果",
    "search.typeToSearch": "输入关键词开始搜索",
    "search.results": "搜索结果",
    // Right sidebar
    "sidebar.right.projectInfo": "项目信息",
    "sidebar.right.repo": "仓库",
    "sidebar.right.addRepo": "添加仓库",
    "sidebar.right.noRepo": "暂无已关联仓库",
    "sidebar.right.addRepoHint": "点击下方添加仓库",
    "sidebar.right.browseRepo": "浏览磁盘上的仓库",
    "sidebar.right.createRepo": "在磁盘上创建新仓库",
    "sidebar.right.recent": "最近",
    "sidebar.right.other": "其他",
    "sidebar.right.browseWip": "浏览磁盘仓库功能开发中",
    "sidebar.right.createWip": "创建仓库功能开发中",
    "sidebar.right.linkWip": "关联仓库功能开发中",
    "sidebar.right.normalType": "普通项目",
    "sidebar.right.gitType": "Git 项目",
    "sidebar.right.edit": "编辑项目",
    "sidebar.right.name": "项目名称",
    "sidebar.right.aliasLabel": "别名",
    "sidebar.right.descLabel": "描述",
    "sidebar.right.save": "保存",
    "sidebar.right.cancel": "取消",
    "sidebar.right.namePlaceholder": "输入项目名称",
    "sidebar.right.aliasPlaceholder": "可选别名",
    "sidebar.right.descPlaceholder": "项目描述",
    // Labels
    "label.manage": "管理标签",
    "label.name": "标签名称",
    "label.color": "颜色",
    "label.builtin": "内置",
    "label.add": "添加标签",
    "label.noLabels": "暂无标签",
    // Settings
    "settings.title": "配置",
    "settings.language": "语言",
    "settings.languageDesc": "切换界面语言",
    // Workspace landing
    "workspace.selectHint": "选择一个工作空间",
    "workspace.selectDesc": "从左侧选择一个工作空间开始",
    // Empty state
    "board.noProject": "该工作空间没有项目，请点击顶部「新建项目」创建",
    // Folder browser
    "folder.selectFolder": "选择文件夹",
    "folder.selectGitRepo": "选择 Git 仓库",
    "folder.hint": "点击文件夹名称进行导航 · 使用操作按钮进行选择",
    "folder.manualInput": "手动输入路径：",
    "folder.goTo": "前往",
    "folder.searchDir": "搜索当前目录：",
    "folder.selectCurrent": "选择当前",
    "folder.selectPath": "选择路径",
    "folder.empty": "此目录下没有文件夹",
    "folder.browse": "浏览",
  },
  en: {
    "sidebar.workspace": "Workspaces",
    "sidebar.newWorkspace": "New Workspace",
    "sidebar.collapse": "Collapse Sidebar",
    "sidebar.expand": "Expand Sidebar",
    "sidebar.rename": "Rename",
    "sidebar.delete": "Delete",
    "sidebar.archive": "Archive",
    "sidebar.manageLabels": "Manage Labels",
    "sidebar.deleteConfirm": "Delete workspace \"{name}\"? All projects and tasks will be deleted.",
    "sidebar.settings": "Settings",
    "workspace.create": "New Workspace",
    "workspace.edit": "Edit Workspace",
    "workspace.name": "Name",
    "workspace.namePlaceholder": "Enter workspace name",
    "workspace.icon": "Icon",
    "common.cancel": "Cancel",
    "common.create": "Create",
    "common.save": "Save",
    "common.delete": "Delete",
    "common.add": "Add",
    "common.edit": "Edit",
    "common.search": "Search",
    "topbar.newProject": "New Project",
    "topbar.searchPlaceholder": "Search tasks, projects, repos...",
    "project.name": "Project Name",
    "project.alias": "Alias",
    "project.description": "Description",
    "project.normalType": "Normal",
    "project.gitType": "Git Project",
    "project.gitUrl": "Git Repository URL",
    "project.namePlaceholder": "Enter project name",
    "project.aliasPlaceholder": "Optional, e.g. Frontend Refactor",
    "project.descPlaceholder": "Optional, project description",
    "project.gitPlaceholder": "https://github.com/...",
    "project.localPath": "Local Path",
    "project.localPathPlaceholder": "/Users/you/projects/my-app",
    "project.localPathHint": "Local folder path of the project",
    "project.edit": "Edit Project",
    "board.kanban": "Task Board",
    "board.overview": "Overview",
    "board.running": "Running",
    "board.tip": "Tips",
    "board.newTask": "New Task",
    "board.allFilter": "All",
    "board.inProgressFilter": "In Progress",
    "board.inReviewFilter": "In Review",
    "task.create": "New Task",
    "task.edit": "Edit Task",
    "task.title": "Task Title",
    "task.titlePlaceholder": "Enter task title",
    "task.description": "Description",
    "task.descPlaceholder": "Enter description (Markdown supported)",
    "task.priority": "Priority",
    "task.labels": "Labels",
    "task.priorityLow": "Low",
    "task.priorityMedium": "Med",
    "task.priorityHigh": "High",
    "task.priorityCritical": "Urgent",
    "taskDetail.title": "Task Chat",
    "taskDetail.back": "Back to list",
    "taskDetail.hasConversation": "Has chat",
    "taskDetail.updatedAt": "Updated",
    "taskDetail.send": "Send",
    "taskDetail.sending": "Sending...",
    "taskDetail.inputPlaceholder": "Enter command...",
    "taskDetail.emptyState": "Start a conversation to execute the task",
    "taskDetail.emptyHint": "Press Enter to send",
    "taskDetail.sendFailed": "Send failed, please retry",
    "taskDetail.filesChanged": "files changed",
    "search.placeholder": "Search tasks, projects, repos...",
    "search.task": "Tasks",
    "search.project": "Projects",
    "search.repository": "Repos",
    "search.noResults": "No results found",
    "search.typeToSearch": "Type to start searching",
    "search.results": "Search Results",
    "sidebar.right.projectInfo": "Project Info",
    "sidebar.right.repo": "Repository",
    "sidebar.right.addRepo": "Add Repository",
    "sidebar.right.noRepo": "No linked repositories",
    "sidebar.right.addRepoHint": "Add a repository below",
    "sidebar.right.browseRepo": "Browse local repos",
    "sidebar.right.createRepo": "Create new repo",
    "sidebar.right.recent": "Recent",
    "sidebar.right.other": "Other",
    "sidebar.right.browseWip": "Browse repos - coming soon",
    "sidebar.right.createWip": "Create repo - coming soon",
    "sidebar.right.linkWip": "Link repo - coming soon",
    "sidebar.right.normalType": "Normal",
    "sidebar.right.gitType": "Git Project",
    "sidebar.right.edit": "Edit Project",
    "sidebar.right.name": "Project Name",
    "sidebar.right.aliasLabel": "Alias",
    "sidebar.right.descLabel": "Description",
    "sidebar.right.save": "Save",
    "sidebar.right.cancel": "Cancel",
    "sidebar.right.namePlaceholder": "Enter project name",
    "sidebar.right.aliasPlaceholder": "Optional alias",
    "sidebar.right.descPlaceholder": "Project description",
    "label.manage": "Manage Labels",
    "label.name": "Label name",
    "label.color": "Color",
    "label.builtin": "Built-in",
    "label.add": "Add Label",
    "label.noLabels": "No labels",
    "settings.title": "Settings",
    "settings.language": "Language",
    "settings.languageDesc": "Switch interface language",
    "workspace.selectHint": "Select a workspace",
    "workspace.selectDesc": "Choose a workspace from the sidebar",
    "board.noProject": "No projects yet. Click \"New Project\" to create one.",
    "folder.selectFolder": "Select Folder",
    "folder.selectGitRepo": "Select Git Repository",
    "folder.hint": "Click folder name to navigate · Use buttons to select",
    "folder.manualInput": "Enter path manually:",
    "folder.goTo": "Go",
    "folder.searchDir": "Search current directory:",
    "folder.selectCurrent": "Select Current",
    "folder.selectPath": "Select Path",
    "folder.empty": "No folders in this directory",
    "folder.browse": "Browse",
  },
} as const;

type TranslationKey = keyof typeof translations.zh;

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, vars?: Record<string, string>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("locale") as Locale) || "zh";
    }
    return "zh";
  });

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    localStorage.setItem("locale", l);
  }, []);

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string>) => {
      let str = (translations[locale] as Record<string, string>)[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = str.replace(`{${k}}`, v);
        }
      }
      return str;
    },
    [locale]
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
