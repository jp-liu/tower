# Preview Module

预览运行中的 dev server，支持 11 种框架自动探测：Next / Nuxt / Vite / Angular / Spring Boot (Maven & Gradle) / Django / FastAPI / Flask / Go / Static HTML。

## 架构

- **Preset 数据**：`src/lib/preview/presets.ts` — 11 个内置预设，每个含 detect rule、command、port、readyRegex、installCommand
- **探测**：`src/lib/preview/detector.ts:detectPreset(cwd)` 纯函数
- **Session 模型**：`(cwd, command, port)` 三元组作为身份，相同三件套共享同一 dev server 进程
- **PTY 复用**：复用 `src/lib/pty/pty-session.ts` 的 `PtySession` 类，但**不**复用 `pty/session-store.ts`，避免和 Claude PTY 互杀

## 探测时机

| 触发 | 时机 | 写入字段 |
|---|---|---|
| T1 | `createProject` / `updateProject` 完成 | `Project.previewPreset` |
| T2 | `getPreviewState` 调用时如果 previewPreset 为 null | `Project.previewPreset`（conditional update via updateMany） |
| T3 | 用户点 Re-detect 按钮 | `Project.previewPreset`（强制覆盖） |
| subPath | 实时（每次 getPreviewState） | 不存 DB |

## Effective Command/Port 计算

```
task.previewCommandOverride  →  project.previewCommand  →  preset.command  →  ""
task.previewPortOverride     →  project.previewPort     →  preset.port     →  0
```

详见 `src/lib/preview/preview-key.ts:getEffectiveCommand` / `getEffectivePort`。

## State Machine

```
stopped → installing → stopped (cancelRequested) / error / stopped (success)
                ↓ (autoStartAfter)
stopped → starting → running / error
running → error (PTY 退出)
running → stopped (用户点 Stop)
```

详见 `src/lib/preview/preview-session.ts`。

## 数据流

```
PreviewPanel (React, client)
  ↓ getPreviewState() server action
preview-actions.ts (server)
  ↓ 计算 effective + 查 session-store
PreviewSession 实例
  ↓ 封装 PtySession
node-pty 子进程（dev server）
```

WebSocket 状态广播：
- 路径：`/?taskId=__preview__&role=state&previewKey=<encoded>&connectionId=<uuid>&clientTaskId=<taskId>`
- output 流：`/?taskId=__preview__&role=terminal&previewKey=<encoded>&...`

## 详细设计 spec

完整设计：`docs/superpowers/specs/2026-05-16-preview-feature-design.md`
实施计划：`docs/superpowers/plans/2026-05-16-preview-feature.md`
