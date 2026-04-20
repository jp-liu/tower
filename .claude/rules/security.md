---
paths:
  - "src/actions/**/*.ts"
  - "src/app/api/**/*.ts"
  - "src/lib/**/*.ts"
---

# Security Rules

## CLI Profile

- `command` field must be validated against allowlist (`claude`, `claude-code`).
- `baseArgs` elements must be strings with no shell metacharacters (`;&|` etc.).
- `envVars` must block dangerous keys: PATH, LD_PRELOAD, DYLD_INSERT_LIBRARIES, NODE_OPTIONS, HOME, SHELL.

## Environment Injection

- Never mutate `process.env` for per-session vars — pass via `envOverrides` to `pty.spawn()`.
- Signal files use `$TMPDIR/tower-signals/` with 0700 dir + 0600 file permissions.

## Internal API Routes

- All `/api/internal/` routes must call `requireLocalhost(request)` + `validateTaskId(taskId)`.
- Task IDs must match CUID format (`/^c[a-z0-9]{20,30}$/`).

## Server Actions

- Catch Prisma `P2025` (record not found) — return user-friendly error, never leak schema details.
- Validate JSON fields (`JSON.parse`) with try/catch before use.
