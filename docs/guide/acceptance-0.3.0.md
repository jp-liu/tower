---
title: 0.3.0 手工验收清单
description: AI Tools、扩展中心、Qwen Provider 与发布前置的最终人工检查
---

# 0.3.0 手工验收清单

自动化结论为“可进入手工验收”，不会自动 publish、push、tag 或创建 Release。

## 发布阻断项

- [x] 集中验收已在原字体配置恢复后通过 `127.0.0.1:7897` 代理运行 `pnpm release:smoke`：打包安装、13 个迁移、Settings、Summary、Assistant 和 Terminal plan 全部通过。更换发布构建环境时仍须提供稳定代理或批准字体缓存。
- [ ] 确认服务默认只监听 `127.0.0.1`；仅在明确需要时传入 `--host`。
- [ ] 决定并授权官方 Catalog 仓库、GitHub Organization 和 HTTPS 托管 URL。建立前设置服务端 `TOWER_EXTENSION_CATALOG_URL` 或系统 Catalog URL。
- [ ] 手工确认 v0.3.0 后再决定 publish/tag/Release；本清单完成不等于自动发布授权。

## Extensions 与 Qwen

- [ ] Extensions 页可加载、搜索并区分 Catalog 空、不可用和无搜索结果。
- [ ] Qwen 卡片显示 Tower Community、`qwen`、版本范围、能力和责任边界；Tower 不安装或登录 Qwen CLI。
- [ ] 在测试账号环境分别确认 CLI missing、版本不兼容和兼容状态；不要使用生产账号或消耗额度。
- [ ] 安装后默认禁用；权限确认后可启用、禁用和重新启用。
- [ ] 使用带新增权限的受控 fixture 验证更新会重新确认权限；再验证损坏提示、重试和卸载。
- [ ] 本地目录开发注册可直接使用，无需普通用户手工执行 `npm install`。

## AI Tools 与能力插槽

- [ ] 创建 OpenAI-compatible 测试连接，检查 Base URL、Model、多 Key、掩码、显示、复制和编辑。
- [ ] 检查 Claude/Codex/Gemini 与已启用动态 Provider 的检测状态和错误原因。
- [ ] 为 Terminal、Summary、Dreaming、Analysis、Assistant 保存主备目标，刷新后顺序保持。
- [ ] 禁用或卸载动态 Provider 后，它不能用于新增目标或执行；既有目标显示明确诊断和回退过程。
- [ ] Terminal 旧会话保持启动时绑定；修改配置后只有新会话使用新目标。

## Assistant、自愈与数据

- [ ] 使用隔离测试数据验证 Assistant 多轮、SSE、工具调用、附件、取消和历史截断。
- [ ] 验证搜索/创建任务工具只影响选择的隔离工作区。
- [ ] 在 fake 配置目录验证 CLI 重装、路径/版本变化和配置漂移后的 MCP/hook/skill reconciliation；失败可重试且无并发破坏。
- [ ] 完整备份恢复后检查 API Key、五插槽、插件 registry/安装目录和 Assistant 会话；临时附件缓存不在保证范围。

## 可视与清理

- [ ] 在 1440x900、1280x720、390x844 检查 Settings、AI Tools、Extensions 和 Assistant，无横向溢出、按钮覆盖或不可读禁用原因。
- [ ] 在 390x844 用键盘打开 TopBar“项目操作”菜单，确认“导入项目”和“新建项目”均可发现、可打开且不溢出。
- [ ] 确认键盘焦点、表单标签、图标提示和中英文文案可访问。
- [ ] 确认没有遗留测试服务、浏览器、临时数据库或监听端口，生产 3000 进程未被重启或复用。
