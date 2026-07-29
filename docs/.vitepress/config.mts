import { defineConfig } from "vitepress";

export default defineConfig({
  base: "/tower/",
  title: "Tower Docs",
  description: "AI Task Orchestration Platform",
  ignoreDeadLinks: true,
  // Only guide/ modules/ en/ index.md are the live site. Other top-level dirs are
  // scratch doc copies not wired into the nav — exclude them so stray markdown
  // (e.g. spec files with pseudo-HTML tags) doesn't break the Vue/MD compiler.
  srcExclude: ["superpowers/**", "specs/**", "design/**", "diagrams/**", "ai/**"],
  appearance: "dark",
  head: [
    ["link", { rel: "icon", href: "/tower/favicon.ico" }],
  ],

  locales: {
    root: {
      label: "简体中文",
      lang: "zh-CN",
      themeConfig: {
        nav: [
          { text: "指南", link: "/guide/introduction" },
          { text: "模块", link: "/modules/workspace" },
          { text: "架构图", link: "/guide/diagrams" },
        ],
        sidebar: [
          {
            text: "指南",
            items: [
              { text: "介绍", link: "/guide/introduction" },
              { text: "快速开始", link: "/guide/getting-started" },
              { text: "AI Tools 0.3", link: "/guide/ai-tools" },
              { text: "升级到 0.3.0", link: "/guide/upgrade-0.3" },
              { text: "CLI Provider 开发", link: "/guide/cli-provider-sdk" },
              { text: "无人值守服务", link: "/guide/unattended-service" },
              { text: "0.3.0 发布说明", link: "/guide/release-0.3.0" },
              { text: "系统架构", link: "/guide/architecture" },
            ],
          },
          {
            text: "模块",
            items: [
              { text: "Workspace 工作区", link: "/modules/workspace" },
              { text: "Project 项目", link: "/modules/project" },
              { text: "Task 任务", link: "/modules/task" },
              { text: "Board 看板", link: "/modules/board" },
              { text: "Terminal 终端", link: "/modules/terminal" },
              { text: "Assistant 助手", link: "/modules/assistant" },
              { text: "Missions 监控", link: "/modules/missions" },
              { text: "Search 搜索", link: "/modules/search" },
              { text: "Settings 设置", link: "/modules/settings" },
              { text: "Agent 能力扩展", link: "/modules/agent-extension" },
              { text: "MCP 工具链", link: "/modules/mcp" },
              { text: "Harness 无人值守", link: "/modules/harness" },
              { text: "Workbench 可靠网关", link: "/modules/workbench-gateway" },
              { text: "网关消息卡片", link: "/modules/gateway-cards" },
              { text: "Git 集成", link: "/modules/git" },
              { text: "Assets & Notes", link: "/modules/assets-notes" },
              { text: "AI 能力", link: "/modules/ai" },
              { text: "I18n 国际化", link: "/modules/i18n" },
            ],
          },
          {
            text: "架构图",
            items: [
              { text: "查看架构图", link: "/guide/diagrams" },
            ],
          },
        ],
      },
    },
    en: {
      label: "English",
      lang: "en-US",
      link: "/en/",
      themeConfig: {
        nav: [
          { text: "Guide", link: "/en/guide/introduction" },
          { text: "Modules", link: "/en/modules/workspace" },
          { text: "Diagrams", link: "/en/guide/diagrams" },
        ],
        sidebar: [
          {
            text: "Guide",
            items: [
              { text: "Introduction", link: "/en/guide/introduction" },
              { text: "Getting Started", link: "/en/guide/getting-started" },
              { text: "AI Tools 0.3", link: "/en/guide/ai-tools" },
              { text: "Upgrade to 0.3.0", link: "/en/guide/upgrade-0.3" },
              { text: "CLI Provider Development", link: "/en/guide/cli-provider-sdk" },
              { text: "Unattended Service", link: "/en/guide/unattended-service" },
              { text: "0.3.0 Release Notes", link: "/en/guide/release-0.3.0" },
              { text: "Architecture", link: "/en/guide/architecture" },
            ],
          },
          {
            text: "Modules",
            items: [
              { text: "Workspace", link: "/en/modules/workspace" },
              { text: "Project", link: "/en/modules/project" },
              { text: "Task", link: "/en/modules/task" },
              { text: "Board", link: "/en/modules/board" },
              { text: "Terminal", link: "/en/modules/terminal" },
              { text: "Assistant", link: "/en/modules/assistant" },
              { text: "Missions", link: "/en/modules/missions" },
              { text: "Search", link: "/en/modules/search" },
              { text: "Settings", link: "/en/modules/settings" },
              { text: "Agent Extension", link: "/en/modules/agent-extension" },
              { text: "MCP", link: "/en/modules/mcp" },
              { text: "Harness (Unattended)", link: "/en/modules/harness" },
              { text: "Reliable Workbench Gateway", link: "/en/modules/workbench-gateway" },
              { text: "Gateway Message Cards", link: "/en/modules/gateway-cards" },
              { text: "Git Integration", link: "/en/modules/git" },
              { text: "Assets & Notes", link: "/en/modules/assets-notes" },
              { text: "AI Capabilities", link: "/en/modules/ai" },
              { text: "I18n", link: "/en/modules/i18n" },
            ],
          },
          {
            text: "Diagrams",
            items: [
              { text: "Architecture Diagrams", link: "/en/guide/diagrams" },
            ],
          },
        ],
      },
    },
  },

  themeConfig: {
    logo: "/logo.png",
    socialLinks: [
      { icon: "github", link: "https://github.com/tower-org/tower" },
    ],
  },
});
