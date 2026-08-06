<p align="center">
  <img src="public/banner.jpg" width="100%" alt="Tower" />
</p>

<p align="center">
  AI task orchestration for developers
</p>
<p align="center">
  <b>English</b> | <a href="./README.zh.md">中文</a>
</p>

Tower turns AI-assisted development into reviewable tasks. Organize work on a
Kanban board, run CLI agents in isolated worktrees, inspect their terminals and
code changes, then move verified work to completion.

## Quick start

Tower requires Node.js 22 or 24.

```sh
npm install -g @tower-org/cli
tower
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Tower binds to the local
machine only; wildcard and LAN addresses are rejected.

Need a GitHub Release installer instead of npm? Use the
[installation guide](https://tower-org.github.io/tower/en/guide/getting-started.html).

## What Tower manages

- **Workspaces, projects, and tasks** -- keep parallel projects and their task
  history separate.
- **Task workbenches** -- run Claude Code, Codex CLI, Gemini CLI, or an enabled
  provider beside files, diffs, previews, and notes.
- **Mission Control** -- monitor and interact with several active task terminals
  from one screen.
- **Automation boundaries** -- expose scoped MCP tools and route approved
  OpenClaw Gateway requests into a resident project Workbench.
- **Assistant sessions** -- search and operate Tower without turning the
  assistant into a permanent project record.

The core hierarchy is:

```text
Workspace -> Project -> Task -> Execution
```

## Documentation

- [Start with Tower](https://tower-org.github.io/tower/en/guide/introduction.html)
- [AI Tools](https://tower-org.github.io/tower/en/guide/ai-tools.html)
- [Automation responsibility map](https://tower-org.github.io/tower/en/guide/automation.html)
- [System architecture](https://tower-org.github.io/tower/en/guide/architecture.html)
- [Release process](https://tower-org.github.io/tower/en/guide/releases.html)
- [Changelog](./CHANGELOG.md)

## Develop from source

```sh
git clone https://github.com/tower-org/tower.git
cd tower
pnpm install
pnpm dev
```

The development server runs at [http://127.0.0.1:9022](http://127.0.0.1:9022)
and stores development data under `~/.tower-dev`.

Useful checks:

```sh
pnpm lint
pnpm test:run
pnpm build
```

## License

[MIT](./LICENSE)
