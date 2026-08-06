import { defineConfig } from "vitepress";

export default defineConfig({
  base: "/tower/",
  title: "Tower Docs",
  description: "AI Task Orchestration Platform",
  ignoreDeadLinks: true,
  // Only guide/ modules/ en/ index.md are the live site. Other top-level dirs are
  // scratch doc copies not wired into the nav — exclude them so stray markdown
  // (e.g. spec files with pseudo-HTML tags) doesn't break the Vue/MD compiler.
  srcExclude: ["superpowers/**", "specs/**", "design/**", "diagrams/**", "ai/**", "releases/**"],
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
          { text: "开始", link: "/guide/introduction" },
          { text: "产品", link: "/modules/workspace" },
          { text: "自动化", link: "/guide/automation" },
          { text: "架构", link: "/guide/architecture" },
          { text: "更新日志", link: "/guide/changelog" },
        ],
        sidebar: [
          {
            text: "开始使用",
            items: [
              { text: "介绍", link: "/guide/introduction" },
              { text: "安装与运行", link: "/guide/getting-started" },
              { text: "AI Tools", link: "/guide/ai-tools" },
            ],
          },
          {
            text: "核心产品",
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
              { text: "Git 集成", link: "/modules/git" },
              { text: "Assets & Notes", link: "/modules/assets-notes" },
              { text: "I18n 国际化", link: "/modules/i18n" },
            ],
          },
          {
            text: "自动化与集成",
            items: [
              { text: "职责边界总览", link: "/guide/automation" },
              { text: "Workbench 协调器", link: "/modules/workbench-gateway" },
              { text: "Gateway 消息响应", link: "/modules/gateway-cards" },
              { text: "MCP 工具协议", link: "/modules/mcp" },
              { text: "Harness 无人值守运行时", link: "/modules/harness" },
              { text: "OpenClaw 集成", link: "/modules/agent-extension" },
              { text: "CLI Provider 开发", link: "/guide/cli-provider-sdk" },
              { text: "无人值守服务", link: "/guide/unattended-service" },
            ],
          },
          {
            text: "架构与发布",
            items: [
              { text: "系统架构", link: "/guide/architecture" },
              { text: "查看架构图", link: "/guide/diagrams" },
              { text: "AI 运行时", link: "/modules/ai" },
              { text: "升级与迁移", link: "/guide/upgrading" },
              { text: "发布流程", link: "/guide/releases" },
              { text: "更新日志", link: "/guide/changelog" },
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
          { text: "Start", link: "/en/guide/introduction" },
          { text: "Product", link: "/en/modules/workspace" },
          { text: "Automation", link: "/en/guide/automation" },
          { text: "Architecture", link: "/en/guide/architecture" },
          { text: "Changelog", link: "/en/guide/changelog" },
        ],
        sidebar: [
          {
            text: "Getting started",
            items: [
              { text: "Introduction", link: "/en/guide/introduction" },
              { text: "Install and run", link: "/en/guide/getting-started" },
              { text: "AI Tools", link: "/en/guide/ai-tools" },
            ],
          },
          {
            text: "Core product",
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
              { text: "Git Integration", link: "/en/modules/git" },
              { text: "Assets & Notes", link: "/en/modules/assets-notes" },
              { text: "I18n", link: "/en/modules/i18n" },
            ],
          },
          {
            text: "Automation and integrations",
            items: [
              { text: "Responsibility map", link: "/en/guide/automation" },
              { text: "Workbench coordinator", link: "/en/modules/workbench-gateway" },
              { text: "Gateway responses", link: "/en/modules/gateway-cards" },
              { text: "MCP tool protocol", link: "/en/modules/mcp" },
              { text: "Harness unattended runtime", link: "/en/modules/harness" },
              { text: "OpenClaw integration", link: "/en/modules/agent-extension" },
              { text: "CLI Provider development", link: "/en/guide/cli-provider-sdk" },
              { text: "Unattended service", link: "/en/guide/unattended-service" },
            ],
          },
          {
            text: "Architecture and releases",
            items: [
              { text: "System architecture", link: "/en/guide/architecture" },
              { text: "Architecture Diagrams", link: "/en/guide/diagrams" },
              { text: "AI runtime", link: "/en/modules/ai" },
              { text: "Upgrade and migration", link: "/en/guide/upgrading" },
              { text: "Release process", link: "/en/guide/releases" },
              { text: "Changelog", link: "/en/guide/changelog" },
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
