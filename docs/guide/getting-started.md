---
title: 安装与快速开始
description: 通过 npm 或经过校验的 GitHub Release 平台包安装 Tower
---

# 安装 Tower

Tower 同时提供 npm 公共包和 GitHub Release 平台包。公司 npm 代理、证书或权限
不稳定时，应使用平台包；它已包含依赖、Prisma Client、Query/Schema Engine、
node-pty 和 ripgrep，安装与首次启动不会访问 npm registry 或
`binaries.prisma.sh`。平台包不包含 Node.js，也不会自动安装 Node.js。

## 1. 检查 Node.js

最低要求为 Node.js `22.0.0`。每个发布资产均在 Node 22 与 Node 24 上实际验证，
这两个版本是官方支持范围。其他 `>=22.0.0` 版本（包括 Node 23）允许以
best-effort 模式继续并显示警告；目前没有额外的已知不兼容版本。检查命令：

```sh
node --version
node -p "Number(process.versions.node.split('.')[0]) >= 22"
```

输出 `false` 或找不到 `node` 时，先安装 Node.js 22 LTS 或 24 LTS。Tower 不会
替你安装或切换 Node。

## 2. npm 安装（标准渠道）

```sh
npm install -g @tower-org/cli
tower --version
tower
```

npm 包继续使用 npm provenance。不要把 `sudo npm install`、
`NODE_TLS_REJECT_UNAUTHORIZED=0` 或 `strict-ssl=false` 当作公司证书问题的常规
解决方案；它们分别扩大权限或关闭 TLS 校验。无法通过企业 CA 访问 npm/Prisma
CDN 时使用下一节的平台包。

## 3. 自动安装平台包

脚本无菜单、不会等待 TTY、默认不启动 Tower，也不使用 sudo。先下载并审阅：

```sh
curl --proto '=https' --tlsv1.2 -fsSLo install.sh \
  https://github.com/tower-org/tower/releases/latest/download/install.sh
less install.sh
sh install.sh --yes --no-start
"$HOME/.local/bin/tower" --version
"$HOME/.local/bin/tower"
```

便利入口（仅在已信任并审阅同版本脚本后使用）：

```sh
curl --proto '=https' --tlsv1.2 -fsSL \
  https://github.com/tower-org/tower/releases/latest/download/install.sh \
  | sh -s -- --yes --no-start
```

Windows PowerShell：

```powershell
Invoke-WebRequest https://github.com/tower-org/tower/releases/latest/download/install.cmd -OutFile install.cmd
Invoke-WebRequest https://github.com/tower-org/tower/releases/latest/download/install.ps1 -OutFile install.ps1
Get-Content .\install.cmd
Get-Content .\install.ps1
.\install.cmd -ConfirmNonInteractive -NoStart
& "$env:LOCALAPPDATA\Tower\bin\tower.ps1" --version
& "$env:LOCALAPPDATA\Tower\bin\tower.ps1"
```

`install.cmd` 必须与 `install.ps1` 放在同一目录，它只是使用 Windows 自带的
PowerShell 和进程级 `ExecutionPolicy Bypass` 转发参数。也可以继续直接执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -ConfirmNonInteractive -NoStart
```

如果公司通过组策略、AppLocker 或 WDAC 禁止 PowerShell，CMD 包装器也无法绕过该
安全策略；此时使用 npm 安装或联系管理员放行经过审核的脚本。

所有参数均可非交互使用：

```sh
sh install.sh --help
sh install.sh --version 0.3.1 --yes --no-start
sh install.sh --download-base https://mirror.example/tower/v0.3.1 --version 0.3.1 --yes --no-start
sh install.sh --prefix "$HOME/apps/tower" --bin-dir "$HOME/bin" --yes --no-start
sh install.sh --verify --yes --no-start
```

`TOWER_DOWNLOAD_BASE_URL` 等价于 `--download-base`，其值必须是直接包含 assets 的
HTTPS 目录。`TOWER_INSTALL_DIR` 与 `TOWER_BIN_DIR` 可覆盖用户安装目录。

## 4. 手动下载、校验、解压

先从 Release 页面确定版本，以下以 `0.3.1` 为例。macOS/Linux 根据机器选择
唯一匹配的资产：

| 系统 | `uname -m` | 资产 |
| --- | --- | --- |
| macOS | `arm64` | `tower-portable-darwin-arm64.tar.gz` |
| macOS | `x86_64` | `tower-portable-darwin-x64.tar.gz` |
| Linux | `aarch64`/`arm64` | `tower-portable-linux-arm64.tar.gz` |
| Linux | `x86_64` | `tower-portable-linux-x64.tar.gz` |
| Windows | x64 | `tower-portable-windows-x64.tar.gz` |

macOS arm64 完整示例（其他 Unix 目标只替换 `ASSET`）：

```sh
VERSION=0.3.1
ASSET=tower-portable-darwin-arm64.tar.gz
BASE="https://github.com/tower-org/tower/releases/download/v$VERSION"
curl --proto '=https' --tlsv1.2 -fsSLO "$BASE/$ASSET"
curl --proto '=https' --tlsv1.2 -fsSLO "$BASE/SHA256SUMS"
grep "  $ASSET$" SHA256SUMS | shasum -a 256 -c -
tar -xzf "$ASSET"
cd "tower-v$VERSION-darwin-arm64"
./bin/tower --version
./install --yes --no-start
"$HOME/.local/bin/tower"
```

Linux 使用同样流程，把校验命令改为：

```sh
grep "  $ASSET$" SHA256SUMS | sha256sum -c -
```

Windows x64：

```powershell
$Version = "0.3.1"
$Asset = "tower-portable-windows-x64.tar.gz"
$Base = "https://github.com/tower-org/tower/releases/download/v$Version"
Invoke-WebRequest "$Base/$Asset" -OutFile $Asset
Invoke-WebRequest "$Base/SHA256SUMS" -OutFile SHA256SUMS
$Expected = ((Get-Content SHA256SUMS | Select-String "  $Asset$") -split "\s+")[0]
$Actual = (Get-FileHash $Asset -Algorithm SHA256).Hash.ToLowerInvariant()
if ($Actual -ne $Expected) { throw "SHA-256 mismatch" }
tar -xzf $Asset
Set-Location "tower-v$Version-windows-x64"
& .\bin\tower.ps1 --version
.\install.cmd -ConfirmNonInteractive -NoStart
# 或直接使用 PowerShell：
& .\install.ps1 -ConfirmNonInteractive -NoStart
& "$env:LOCALAPPDATA\Tower\bin\tower.ps1"
```

便携运行不需要安装，始终可在解压目录执行 `./bin/tower`（Windows 为
`.\bin\tower.ps1`）。Tower 数据默认仍写入 `~/.tower`。

## 5. 离线复制与企业镜像

在联网机器下载平台资产、`SHA256SUMS`，以及已审阅的对应 `install.sh`；Windows
需同时下载相邻的 `install.cmd` 和 `install.ps1`。将这些文件复制到离线机器后执行：

```sh
sh install.sh --asset-dir /mnt/tower-release --version 0.3.1 --yes --no-start
```

```powershell
.\install.cmd -AssetDir D:\tower-release -Version 0.3.1 -ConfirmNonInteractive -NoStart
```

该路径不调用 npm/pnpm。企业镜像必须原样保存资产与 `SHA256SUMS`；内容冲突应
失败，不应覆盖校验值。

## 6. 服务、升级、回滚与卸载

首次启动确认无误后，macOS/Windows 可选安装当前用户后台服务：

```sh
"$HOME/.local/bin/tower" service install
"$HOME/.local/bin/tower" service status
"$HOME/.local/bin/tower" service remove
```

```powershell
& "$env:LOCALAPPDATA\Tower\bin\tower.ps1" service install
& "$env:LOCALAPPDATA\Tower\bin\tower.ps1" service status
& "$env:LOCALAPPDATA\Tower\bin\tower.ps1" service remove
```

Linux 第一阶段不支持 `tower service`；直接运行 `tower`，或由你自己的用户级
服务管理器托管。服务安装不是平台包安装器的默认动作。

升级到指定版本并保留上一版本：

```sh
sh install.sh --version 0.3.1 --yes --no-start
sh install.sh --rollback --yes
```

普通卸载删除应用与启动器，但保留 `~/.tower` 数据：

```sh
sh install.sh --uninstall --yes
```

PowerShell 对应命令：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Version 0.3.1 -ConfirmNonInteractive -NoStart
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Rollback -ConfirmNonInteractive
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall -ConfirmNonInteractive
```

彻底清理数据是不可恢复操作，只在已确认不再需要任务、凭据和数据库后执行：

```sh
rm -rf "$HOME/.tower"
```

```powershell
Remove-Item -Recurse -Force "$HOME\.tower"
```

## 7. 故障处理

- `TOWER_ERROR=NODE_NOT_FOUND`：安装 Node.js >=22 后重试。
- `TOWER_ERROR=UNSUPPORTED_NODE`：当前版本低于 22；升级 Node 后重试。
- `TOWER_WARNING=UNTESTED_NODE`：当前版本满足最低要求但不在 Node 22/24
  发布矩阵内；可继续 best-effort，或切换到 22/24 复现问题。
- SHA-256 不匹配：停止安装，重新从可信 Release/企业镜像下载，不要跳过校验。
- npm 或 Prisma CDN 出现企业 CA 错误：改用平台包。其原生 Engine 已在对应平台
  runner 准备并经阻断网络 smoke 验证，安装和首次启动不访问这些端点。
- `./bin/tower --verify` 不是有效命令；验证包使用 `./install --verify`，验证 Tower
  版本使用 `./bin/tower --version`。

## 从源码开发

```sh
git clone https://github.com/tower-org/tower.git tower
cd tower
pnpm install
cp .env.example .env
pnpm db:push
pnpm db:seed
pnpm db:init-fts
pnpm dev
```

访问 [http://localhost:3000](http://localhost:3000)。
