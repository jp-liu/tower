<p align="center">
  <img src="public/banner.jpg" width="100%" alt="Tower" />
</p>

<p align="center">
  面向开发者的 AI 任务调度平台
</p>
<p align="center">
  <a href="./README.md">English</a> | <b>中文</b>
</p>

Tower 把 AI 辅助开发组织成可审查的任务：在看板上安排工作，让 CLI Agent 在隔离
工作树中执行，检查终端与代码变更，再将验收完成的工作归档。

## 快速开始

Tower 需要 Node.js 22 或 24。

```sh
npm install -g @tower-org/cli
tower
```

访问 [http://127.0.0.1:3000](http://127.0.0.1:3000)。Tower 只监听本机回环地址，
会拒绝通配地址和局域网地址。

不方便访问 npm 时，使用 [GitHub Release 安装指南](https://tower-org.github.io/tower/guide/getting-started.html)。

## Tower 管理什么

- **工作区、项目与任务**：隔离多个并行项目及其任务历史。
- **任务工作台**：在文件、Diff、预览和笔记旁运行 Claude Code、Codex CLI、
  Gemini CLI 或已启用的 Provider。
- **Mission Control**：在一个页面监控并操作多个正在执行的任务终端。
- **自动化边界**：通过受限 MCP 工具开放能力，并把获准的 OpenClaw Gateway
  请求交给项目常驻 Workbench。
- **助手会话**：用于搜索和操作 Tower，不把助手聊天当作永久项目资料。

核心层级：

```text
工作区 -> 项目 -> 任务 -> 执行记录
```

## 文档

- [开始使用](https://tower-org.github.io/tower/guide/introduction.html)
- [AI Tools](https://tower-org.github.io/tower/guide/ai-tools.html)
- [自动化职责边界](https://tower-org.github.io/tower/guide/automation.html)
- [系统架构](https://tower-org.github.io/tower/guide/architecture.html)
- [发布流程](https://tower-org.github.io/tower/guide/releases.html)
- [更新日志](./CHANGELOG.md)

## 从源码开发

```sh
git clone https://github.com/tower-org/tower.git
cd tower
pnpm install
pnpm dev
```

开发服务器位于 [http://127.0.0.1:9022](http://127.0.0.1:9022)，开发数据写入
`~/.tower-dev`。

常用检查：

```sh
pnpm lint
pnpm test:run
pnpm build
```

## 许可证

[MIT](./LICENSE)
