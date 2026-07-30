---
title: Unattended Service
description: Optionally install, inspect, and remove the Tower background service on macOS and Windows
---

# Unattended Service

Tower can run manually or start automatically after the user signs in. The
background service is optional and is intended for machines that stay online
while Tower is controlled through Feishu or another gateway.

## When to use it

| Scenario | Recommendation |
|---|---|
| Developing or frequently debugging Tower | Run `tower start` manually |
| Start after sign-in and recover after a crash | Install the unattended service |
| Occasional Tower use | Do not install it |

Do not run a manual server and the unattended service on the same port.

## Unified commands

After a production build:

```bash
tower service install
tower service status
tower service remove
```

- `install` registers and immediately starts the service.
- `status` reads the real operating-system service state.
- `remove` stops and unregisters the service without deleting Tower data.

## macOS

macOS uses a per-user LaunchAgent:

- Label: `org.tower.workbench`
- Starts after sign-in: yes
- Restarts after an unexpected exit: yes
- Default listener: `127.0.0.1:3000`
- Logs: `~/.tower/logs/service.stdout.log` and
  `~/.tower/logs/service.stderr.log`

Administrator access is not required. The service runs only while that macOS
user has a login session.

## Windows

Windows uses a per-user Task Scheduler entry:

- Task name: `Tower Workbench`
- Trigger: user logon
- Run level: current user, `LIMITED`
- Default listener: `127.0.0.1:3000`
- Crash recovery: the wrapper waits 10 seconds and starts Tower again
- Wrapper: `%USERPROFILE%\.tower\service\tower-service.cmd`
- Logs: `%USERPROFILE%\.tower\logs\service.stdout.log` and
  `service.stderr.log`

PowerShell example:

```powershell
tower service install
tower service status
Get-Content "$HOME\.tower\logs\service.stderr.log" -Tail 100
tower service remove
```

## Security boundaries

- Installing the service keeps Tower on loopback by default; it does not expose
  Tower to a LAN or the public Internet.
- It does not install OpenClaw or modify `.codex`, `.codex-desktop`, or their
  authentication environments.
- The data directory, database, key, and service logs remain owned by the
  current user.
- Remote access should use explicit authentication, firewall rules, and a
  reverse proxy instead of directly binding Tower to `0.0.0.0`.

## Restarting after an update

For a source deployment, rebuild before replacing the service:

```bash
pnpm build
tower service remove
tower service install
```

Running `install` again is idempotent: Tower replaces the previous registration
and starts the new build.
