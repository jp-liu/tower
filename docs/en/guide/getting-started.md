---
title: Installation and Getting Started
description: Install Tower from npm or verified GitHub Release portable assets
---

# Install Tower

Tower provides the public npm package and GitHub Release portable assets in
parallel. Use a portable asset when corporate npm proxies, certificates, or
permissions are unreliable. It already contains dependencies, generated Prisma
Client, Query/Schema Engines, node-pty, and ripgrep. Installation and first
startup do not contact npm or `binaries.prisma.sh`. Node.js is not bundled or
installed automatically.

## 1. Check Node.js

The minimum is Node.js `22.0.0`. Every release target is tested on Node 22 and
Node 24; those are the officially supported versions. Other versions meeting
the minimum, including Node 23, continue in best-effort mode with a warning.
There are currently no additional known-incompatible versions.

```sh
node --version
node -p "Number(process.versions.node.split('.')[0]) >= 22"
```

If this prints `false` or `node` is missing, install Node.js 22 LTS or 24 LTS
first. Tower never installs or switches Node for you.

## 2. npm (standard channel)

```sh
npm install -g @tower-org/cli
tower --version
tower
```

The npm package retains npm provenance. Do not use `sudo npm install`,
`NODE_TLS_REJECT_UNAUTHORIZED=0`, or `strict-ssl=false` as routine corporate CA
workarounds; they expand privileges or disable TLS validation. Use a portable
asset when npm or the Prisma CDN is unavailable through the corporate CA.

## 3. Automated portable install

The installer has no menus, never waits for a TTY, does not use sudo, and does
not start Tower by default. Download and review it first:

```sh
curl --proto '=https' --tlsv1.2 -fsSLo install.sh \
  https://github.com/tower-org/tower/releases/latest/download/install.sh
less install.sh
sh install.sh --yes --no-start
"$HOME/.local/bin/tower" --version
"$HOME/.local/bin/tower"
```

Convenience form, only after reviewing and trusting that script version:

```sh
curl --proto '=https' --tlsv1.2 -fsSL \
  https://github.com/tower-org/tower/releases/latest/download/install.sh \
  | sh -s -- --yes --no-start
```

Windows PowerShell:

```powershell
Invoke-WebRequest https://github.com/tower-org/tower/releases/latest/download/install.cmd -OutFile install.cmd
Invoke-WebRequest https://github.com/tower-org/tower/releases/latest/download/install.ps1 -OutFile install.ps1
Get-Content .\install.cmd
Get-Content .\install.ps1
.\install.cmd -ConfirmNonInteractive -NoStart
& "$env:LOCALAPPDATA\Tower\bin\tower.ps1" --version
& "$env:LOCALAPPDATA\Tower\bin\tower.ps1"
```

Keep `install.cmd` beside `install.ps1`. The CMD file only forwards arguments
through the built-in Windows PowerShell with a process-scoped
`ExecutionPolicy Bypass`. Direct PowerShell execution remains available:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -ConfirmNonInteractive -NoStart
```

The CMD wrapper cannot bypass PowerShell restrictions enforced by Group Policy,
AppLocker, or WDAC. Use the npm channel or ask an administrator to allow the
reviewed script in that environment.

Deterministic non-interactive options:

```sh
sh install.sh --help
sh install.sh --version X.Y.Z --yes --no-start
sh install.sh --download-base https://mirror.example/tower/vX.Y.Z --version X.Y.Z --yes --no-start
sh install.sh --prefix "$HOME/apps/tower" --bin-dir "$HOME/bin" --yes --no-start
sh install.sh --verify --yes --no-start
```

`TOWER_DOWNLOAD_BASE_URL` is equivalent to `--download-base` and names the
HTTPS directory containing the assets. `TOWER_INSTALL_DIR` and `TOWER_BIN_DIR`
override the user directories.

## 4. Manual download, verification, and extraction

Choose a version on the Release page, replace `X.Y.Z` below, and select exactly one asset for the machine:

| OS | CPU | Asset |
| --- | --- | --- |
| macOS | `arm64` | `tower-portable-darwin-arm64.tar.gz` |
| macOS | `x86_64` | `tower-portable-darwin-x64.tar.gz` |
| Linux | `aarch64`/`arm64` | `tower-portable-linux-arm64.tar.gz` |
| Linux | `x86_64` | `tower-portable-linux-x64.tar.gz` |
| Windows | x64 | `tower-portable-windows-x64.tar.gz` |

Complete macOS arm64 example (change `ASSET` for another Unix target):

```sh
VERSION=X.Y.Z
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

On Linux, replace the checksum command with:

```sh
grep "  $ASSET$" SHA256SUMS | sha256sum -c -
```

Windows x64:

```powershell
$Version = "X.Y.Z"
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
# Or invoke PowerShell directly:
& .\install.ps1 -ConfirmNonInteractive -NoStart
& "$env:LOCALAPPDATA\Tower\bin\tower.ps1"
```

Portable use requires no install: run `./bin/tower` in the extracted directory
(`.\bin\tower.ps1` on Windows). Data still defaults to `~/.tower`.

## 5. Offline and corporate mirrors

Download an asset, `SHA256SUMS`, and the matching reviewed `install.sh` on a
connected machine. On Windows, download both adjacent files, `install.cmd` and
`install.ps1`. Copy the files to the offline machine:

```sh
sh install.sh --asset-dir /mnt/tower-release --version X.Y.Z --yes --no-start
```

```powershell
.\install.cmd -AssetDir D:\tower-release -Version X.Y.Z -ConfirmNonInteractive -NoStart
```

This path never invokes npm/pnpm. A mirror must retain the assets and
`SHA256SUMS` unchanged.

## 6. Service, upgrade, rollback, and uninstall

After first-start verification, macOS and Windows users may opt into a per-user
service:

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

Linux does not support `tower service` in phase one. Run `tower` directly or use
your own user-level service manager. Service installation is never an installer
default.

Upgrade while retaining the previous version, then roll back if needed:

```sh
sh install.sh --version X.Y.Z --yes --no-start
sh install.sh --rollback --yes
```

Normal uninstall removes application files and launchers but preserves
`~/.tower`:

```sh
sh install.sh --uninstall --yes
```

PowerShell equivalents:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Version X.Y.Z -ConfirmNonInteractive -NoStart
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Rollback -ConfirmNonInteractive
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall -ConfirmNonInteractive
```

Deleting data is irreversible. Only after confirming that tasks, credentials,
and the database are no longer needed:

```sh
rm -rf "$HOME/.tower"
```

```powershell
Remove-Item -Recurse -Force "$HOME\.tower"
```

## 7. Troubleshooting

- `TOWER_ERROR=NODE_NOT_FOUND`: install Node.js >=22 and retry.
- `TOWER_ERROR=UNSUPPORTED_NODE`: upgrade a Node version below 22.
- `TOWER_WARNING=UNTESTED_NODE`: the version meets the minimum but is outside
  the Node 22/24 release matrix. Continue best-effort or reproduce on 22/24.
- SHA-256 mismatch: stop and redownload from a trusted Release or mirror.
- Corporate CA failure from npm or the Prisma CDN: use a portable asset. Native
  engines are prepared on the matching runner and first-start smoke runs with
  those download endpoints blocked.
- `./bin/tower --verify` is not valid. Use `./install --verify` for payload
  verification and `./bin/tower --version` for the CLI version.

## Source development

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

Open [http://localhost:3000](http://localhost:3000).
