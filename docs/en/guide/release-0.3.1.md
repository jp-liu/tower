---
title: 0.3.1 Release Notes
description: Reliable Workbench gateway, personal-bot authorization, unattended services, and message cards
---

# Tower 0.3.1

Tower 0.3.1 upgrades the project Workbench from process-local scheduling to a recoverable durable workflow and completes the personal-bot, remote-review, and cross-platform unattended-service paths.

## Highlights

- Durable Workbench inbox, leased batch ACKs, heartbeat, recovery scans, and generation fencing.
- A recoverable loop from Gateway ingress through task confirmation, Workbench review, and the FINAL_RESULT outbox.
- `Task=DONE`, the final delivery intent, and Gateway business completion commit in one database transaction.
- External delivery is explicitly at-least-once. Uncertain platform sends enter `SENT_UNVERIFIED` instead of being blindly repeated.
- Separate OWNER and NON_OWNER routing. Non-owners may query authorized projects but cannot create work, mutate Tower data, or operate the computer.
- Remote Git projects support read-only review and an owner-authorized full-work mode.
- User-managed unattended services use LaunchAgent on macOS and Scheduled Tasks on Windows.
- Feishu queue, task-created, completion, and diagnostic responses use structured cards.
- Missions reports Workbench generation, queue state, and recovery health without false BUSY states or idle resurrection.

## Reliability boundaries

- Only the runtime holding the database leader lease may run background scanners.
- Workbench event responsibility is retained until its batch reaches `RESOLVED`.
- Platform delivery failures do not roll back completed business work; the delivery worker retries independently.
- Remote projects do not execute untrusted scripts by default. FULL_WORK remains owner-only.

## Release verification

- Full Vitest suite: 235 test files and 2,165 tests passed.
- Production build, release gate, package canary, entrypoint checks, and npm pack dry-run passed.
- Playwright uses a dedicated port and disposable database and cannot reuse the user's localhost:3000 service or Tower data.

See [Reliable Workbench Gateway](/en/modules/workbench-gateway), [Harness](/en/modules/harness), [Unattended Service](/en/guide/unattended-service), and [Diagrams](/en/guide/diagrams) for the full architecture and operations material.
