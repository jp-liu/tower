---
title: 安装与运行
description: 用一条命令安装 Tower，并了解校验、离线与恢复选项
---

# 安装 Tower

Tower 支持 Node.js 22 和 24。先确认当前版本：

```sh
node --version
```

## macOS / Linux

粘贴以下命令即可安装当前 GitHub Release：

```sh
curl --proto '=https' --tlsv1.2 -fsSL https://github.com/tower-org/tower/releases/latest/download/install.sh | sh
```

安装器会选择当前系统和 CPU 对应的平台包、校验 `SHA256SUMS`，并安装到当前用户
目录。它不使用 `sudo`，也不会自动启动 Tower。

```sh
"$HOME/.local/bin/tower" --version
"$HOME/.local/bin/tower"
```

## Windows

在 PowerShell 中粘贴一行：

```powershell
$i="$env:TEMP\tower-install.ps1"; Invoke-WebRequest https://github.com/tower-org/tower/releases/latest/download/install.ps1 -OutFile $i; powershell -NoProfile -ExecutionPolicy Bypass -File $i
```

然后运行：

```powershell
& "$env:LOCALAPPDATA\Tower\bin\tower.ps1" --version
& "$env:LOCALAPPDATA\Tower\bin\tower.ps1"
```

浏览器访问 [http://127.0.0.1:3000](http://127.0.0.1:3000)。Tower 只允许本机
回环地址，不接受 `0.0.0.0` 或局域网监听地址。

## npm 安装

能正常访问 npm registry 时也可以使用标准包：

```sh
npm install -g @tower-org/cli
tower
```

不要用 `sudo npm install`、`NODE_TLS_REJECT_UNAUTHORIZED=0` 或
`strict-ssl=false` 绕过权限或 TLS 问题；无法访问 npm 时直接使用上面的平台包。

## 安装器做了什么

平台包包含生产依赖、Prisma Engine、`node-pty` 和 ripgrep，因此安装与首次启动
不会访问 npm registry 或 `binaries.prisma.sh`。它不包含 Node.js，也不会替你安装
Node.js。

发布流水线分别验证 Node 22 和 24，以及以下平台资产：

| 系统 | CPU | Release 资产 |
| --- | --- | --- |
| macOS | arm64 | `tower-portable-darwin-arm64.tar.gz` |
| macOS | x64 | `tower-portable-darwin-x64.tar.gz` |
| Linux | arm64 | `tower-portable-linux-arm64.tar.gz` |
| Linux | x64 | `tower-portable-linux-x64.tar.gz` |
| Windows | x64 | `tower-portable-windows-x64.tar.gz` |

## 安全审阅

不希望直接执行远程脚本时，先下载再阅读：

```sh
curl --proto '=https' --tlsv1.2 -fsSLo install.sh https://github.com/tower-org/tower/releases/latest/download/install.sh
less install.sh
sh install.sh --no-start
```

Windows 下载并审阅 PowerShell 安装器：

```powershell
Invoke-WebRequest https://github.com/tower-org/tower/releases/latest/download/install.ps1 -OutFile install.ps1
Get-Content .\install.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -ConfirmNonInteractive -NoStart
```

## 离线、镜像与恢复

安装器参数均为非交互模式：

```sh
sh install.sh --help
VERSION=X.Y.Z
sh install.sh --version "$VERSION" --no-start
sh install.sh --download-base "https://mirror.example/tower/v$VERSION" --version "$VERSION"
sh install.sh --asset-dir /mnt/tower-release --version "$VERSION"
sh install.sh --verify
sh install.sh --rollback
sh install.sh --uninstall
```

- `--download-base` 指向直接包含平台包与 `SHA256SUMS` 的 HTTPS 目录。
- `--asset-dir` 从已下载的本地资产目录安装，适合离线环境。
- `--verify` 只解压和验证，不安装。
- `--rollback` 切回上一安装版本。
- `--uninstall` 删除程序与启动器，但保留 `~/.tower` 中的任务、配置和数据库。

PowerShell 使用对应参数 `-DownloadBase`、`-AssetDir`、`-Verify`、`-Rollback`、
`-Uninstall` 和 `-NoStart`。

## 可选后台服务

默认始终手动启动。macOS 或 Windows 如需登录后自动运行，可主动安装当前用户服务：

```sh
tower service install
tower service status
tower service remove
```

Linux 当前不提供内置 `tower service`。

## 常见错误

- `TOWER_ERROR=NODE_NOT_FOUND`：安装 Node.js 22 或 24。
- `TOWER_ERROR=UNSUPPORTED_NODE`：当前 Node 低于 22，需要升级。
- `TOWER_WARNING=UNTESTED_NODE`：版本满足最低要求，但不在 22/24 发布矩阵内。
- SHA-256 不匹配：停止安装，从可信 Release 或镜像重新下载。
- 企业 CA 阻止 npm 或 Prisma CDN：使用平台包，不要关闭 TLS 校验。

## 从源码开发

```sh
git clone https://github.com/tower-org/tower.git
cd tower
pnpm install
pnpm dev
```

开发服务器位于 [http://127.0.0.1:9022](http://127.0.0.1:9022)。
