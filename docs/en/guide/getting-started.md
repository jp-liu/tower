---
title: Install and run
description: Install Tower with one command and find verification, offline, and recovery options
---

# Install Tower

Tower supports Node.js 22 and 24. Check the current version first:

```sh
node --version
```

## macOS / Linux

Paste this command to install the current GitHub Release:

```sh
curl --proto '=https' --tlsv1.2 -fsSL https://github.com/tower-org/tower/releases/latest/download/install.sh | sh
```

The installer selects the platform asset for the current OS and CPU, verifies
`SHA256SUMS`, and installs under the current user. It does not use `sudo` or
start Tower automatically.

```sh
"$HOME/.local/bin/tower" --version
"$HOME/.local/bin/tower"
```

## Windows

Paste one line into PowerShell:

```powershell
$i="$env:TEMP\tower-install.ps1"; Invoke-WebRequest https://github.com/tower-org/tower/releases/latest/download/install.ps1 -OutFile $i; powershell -NoProfile -ExecutionPolicy Bypass -File $i
```

Then run:

```powershell
& "$env:LOCALAPPDATA\Tower\bin\tower.ps1" --version
& "$env:LOCALAPPDATA\Tower\bin\tower.ps1"
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Tower accepts loopback
addresses only; it rejects `0.0.0.0` and LAN bind addresses.

## npm installation

Use the standard package when npm is available:

```sh
npm install -g @tower-org/cli
tower
```

Do not use `sudo npm install`, `NODE_TLS_REJECT_UNAUTHORIZED=0`, or
`strict-ssl=false` to bypass permissions or TLS failures. Use the portable
installer above when npm is unavailable.

## What the installer does

Portable assets contain production dependencies, Prisma Engines, `node-pty`,
and ripgrep. Installation and first startup therefore do not contact npm or
`binaries.prisma.sh`. Node.js is not bundled or installed for you.

The release pipeline verifies Node 22 and 24 on these assets:

| OS | CPU | Release asset |
| --- | --- | --- |
| macOS | arm64 | `tower-portable-darwin-arm64.tar.gz` |
| macOS | x64 | `tower-portable-darwin-x64.tar.gz` |
| Linux | arm64 | `tower-portable-linux-arm64.tar.gz` |
| Linux | x64 | `tower-portable-linux-x64.tar.gz` |
| Windows | x64 | `tower-portable-windows-x64.tar.gz` |

## Review before execution

Download and inspect the script when your policy does not permit direct remote
execution:

```sh
curl --proto '=https' --tlsv1.2 -fsSLo install.sh https://github.com/tower-org/tower/releases/latest/download/install.sh
less install.sh
sh install.sh --no-start
```

On Windows, download `install.cmd` beside `install.ps1`. The CMD file only
forwards arguments to Windows PowerShell:

```powershell
Invoke-WebRequest https://github.com/tower-org/tower/releases/latest/download/install.cmd -OutFile install.cmd
Invoke-WebRequest https://github.com/tower-org/tower/releases/latest/download/install.ps1 -OutFile install.ps1
Get-Content .\install.ps1
.\install.cmd -ConfirmNonInteractive -NoStart
```

## Offline, mirror, and recovery options

Every installer option is non-interactive:

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

- `--download-base` names the HTTPS directory containing assets and `SHA256SUMS`.
- `--asset-dir` installs from an existing local asset directory for offline use.
- `--verify` extracts and verifies without installing.
- `--rollback` switches to the previous installed version.
- `--uninstall` removes the application and launchers while preserving tasks,
  settings, and the database under `~/.tower`.

PowerShell provides `-DownloadBase`, `-AssetDir`, `-Verify`, `-Rollback`,
`-Uninstall`, and `-NoStart` equivalents.

## Optional background service

Manual startup remains the default. On macOS or Windows, opt into a per-user
service only when you want Tower to start after login:

```sh
tower service install
tower service status
tower service remove
```

Linux does not currently provide the built-in `tower service` command.

## Common errors

- `TOWER_ERROR=NODE_NOT_FOUND`: install Node.js 22 or 24.
- `TOWER_ERROR=UNSUPPORTED_NODE`: upgrade a Node version below 22.
- `TOWER_WARNING=UNTESTED_NODE`: the minimum is met, but the version is outside
  the Node 22/24 release matrix.
- SHA-256 mismatch: stop and redownload from a trusted Release or mirror.
- A corporate CA blocks npm or the Prisma CDN: use a portable asset; do not
  disable TLS validation.

## Develop from source

```sh
git clone https://github.com/tower-org/tower.git
cd tower
pnpm install
pnpm dev
```

The development server runs at [http://127.0.0.1:9022](http://127.0.0.1:9022).
