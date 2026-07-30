---
title: 无人值守服务
description: 在 macOS 与 Windows 上按需安装、检查和移除 Tower 后台服务
---

# 无人值守服务

Tower 可以手动运行，也可以由操作系统在用户登录后自动启动。后台服务是可选能力，
适合把电脑留在公司、通过飞书等入口持续使用 Tower 的场景。

## 什么时候需要

| 使用方式 | 建议 |
|---|---|
| 正在开发或频繁调试 Tower | 手动运行 `tower start` |
| 希望登录后自动启动、异常退出后恢复 | 安装无人值守服务 |
| 临时使用 Tower | 不必安装 |

不要让手动进程和无人值守服务同时占用同一个端口。

## 统一命令

完成生产构建后运行：

```bash
tower service install
tower service status
tower service remove
```

- `install`：安装并立即启动。
- `status`：读取操作系统中的真实服务状态。
- `remove`：停止并移除服务，不删除 Tower 数据库、任务或项目。

## macOS

macOS 使用当前用户的 LaunchAgent：

- 服务标识：`org.tower.workbench`
- 登录后启动：是
- 异常退出后重启：是
- 默认监听：`127.0.0.1:3000`
- 日志：`~/.tower/logs/service.stdout.log` 与
  `~/.tower/logs/service.stderr.log`

无需管理员权限，但只有该 macOS 用户登录后服务才会运行。

## Windows

Windows 使用当前用户的 Task Scheduler：

- 任务名称：`Tower Workbench`
- 触发方式：用户登录
- 权限：当前用户、`LIMITED`
- 默认监听：`127.0.0.1:3000`
- 异常退出：包装脚本等待 10 秒后重新启动
- 包装脚本：`%USERPROFILE%\.tower\service\tower-service.cmd`
- 日志：`%USERPROFILE%\.tower\logs\service.stdout.log` 与
  `service.stderr.log`

PowerShell 示例：

```powershell
tower service install
tower service status
Get-Content "$HOME\.tower\logs\service.stderr.log" -Tail 100
tower service remove
```

## 安全边界

- 服务默认只监听 loopback，不会因为安装服务而开放局域网或公网。
- 服务不安装 OpenClaw，也不修改 `.codex`、`.codex-desktop` 或其认证环境。
- 数据目录、数据库、密钥和服务日志使用当前用户权限。
- 需要网络访问时应显式配置反向代理、认证与防火墙，而不是直接绑定
  `0.0.0.0`。

## 更新后的重启

源码部署更新后先重新构建，再重启服务：

```bash
pnpm build
tower service remove
tower service install
```

重新执行 `install` 是幂等的：Tower 会替换旧注册并启动新构建。
