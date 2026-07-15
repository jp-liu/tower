# Spec: Tower Agent Extensions For OpenClaw And Hermes

## Summary

Add first-class Tower Agent extensions for OpenClaw and Hermes. Installing an
extension writes a gateway-native profile with Tower MCP, Tower skills, and
Tower bridge rules. The implementation follows existing gateway/profile
conventions and does not modify gateway model/provider behavior.

## User Stories

- As a Tower user, I can install Tower globally from npm and then install a
  Tower assistant profile into OpenClaw or Hermes from Settings -> Extensions.
- As an office chat user, I can @ the Tower assistant in Feishu/WeChat and have
  it create Tower tasks with images/files attached.
- As an unattended task agent, I can send messages through the configured
  OpenClaw/Hermes route without manually remembering gateway syntax.
- As an enterprise user, I can control proxy/no-proxy behavior via my local
  gateway environment instead of Tower hard-coding company domains.

## Scope

In scope:

- bundled `extensions/tower-agent` resources;
- OpenClaw profile file installation;
- Hermes profile installation through the existing Hermes adapter;
- extension registry entries;
- npm package inclusion;
- non-build unit tests for installer behavior.

Out of scope:

- model/fallback/provider configuration;
- gateway startup/restart automation;
- downstream Feishu/OpenCloud app creation;
- production automation test runs;
- split repository/package.

## Acceptance Criteria

1. Settings -> Extensions lists `Tower Agent (OpenClaw)` and
   `Tower Agent (Hermes)`.
2. `Tower Agent (OpenClaw)` install writes a profile workspace with:
   - `SOUL.md`, `AGENTS.md`, `TOOLS.md`;
   - `mcp.json`;
   - copied `tower` skill only;
   - marker `.tower-agent.json`;
   - an `agents.list` entry in `openclaw.json`.
3. OpenClaw install does not create model/provider settings. If the target
   agent already has user-owned model/provider fields, reinstall preserves them.
4. `Tower Agent (Hermes)` install writes the profile files and delegates
   MCP/skill installation to the Hermes adapter.
5. npm package `files` includes `extensions/`.
6. Tests cover OpenClaw install/check/uninstall and extension registry entries.
7. No build or production restart is required for this change.

## Risks

- OpenClaw's profile schema can change. The installer therefore writes a small
  conservative agent entry and keeps the richer behavior in workspace files.
- Hermes profile distribution can grow a more formal package API later. The
  current implementation delegates to the existing Hermes adapter so we have one
  config writer.
- Existing user profiles may contain manual edits. The installer overwrites only
  the Tower-managed workspace files and backs up `openclaw.json` before writing.
