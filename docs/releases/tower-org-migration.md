# tower-org migration matrix and release controls

Date: 2026-07-27

## Approved identity matrix

| Role | Previous identity | Approved identity | Version | Publication boundary |
| --- | --- | --- | --- | --- |
| Tower application CLI | `tower-studio` | `@tower-org/cli` | `0.3.0` | Public; exposes only the `tower` bin |
| CLI provider SDK | `@tower/ai-sdk` | `@tower-org/ai-sdk` | `0.1.0` | Private workspace package in this release |
| AI host runtime | `@tower/ai-runtime` | `@tower-org/ai-runtime` | `0.1.0` | Private workspace package |
| Claude provider | `@tower/ai-provider-claude` | `@tower-org/ai-provider-claude` | `0.1.0` | Private workspace package; `publisher.id = tower` |
| Codex provider | `@tower/ai-provider-codex` | `@tower-org/ai-provider-codex` | `0.1.0` | Private workspace package; `publisher.id = tower` |
| Gemini provider | `@tower/ai-provider-gemini` | `@tower-org/ai-provider-gemini` | `0.1.0` | Private workspace package; `publisher.id = tower` |
| Qwen community extension | `tower-extension-qwen-code` | unchanged | `0.1.0` | Private Catalog build input; `publisher.id = tower-community` |
| GitHub repository | `jp-liu/tower` | `tower-org/tower` | history preserved | Transfer in place; keep the monorepo |

The npm scope identifies package ownership. Extension `publisher.id` is a
separate stable trust identity and is deliberately not rewritten. Changing the
Qwen package scope would alter its artifact package identity without changing
its Catalog ID (`community.qwen-code`) or trust identity, so it is outside this
migration.

## Public registry audit

Read-only checks against `https://registry.npmjs.org/` on 2026-07-27 found:

- `tower-studio` exists at `0.2.60` and needs a post-release migration notice.
- The five previous `@tower/*` names return `E404`; they must never be published.
- `@tower-org/cli` returns `E404` before the first release and was available.

The legacy unscoped package cannot be renamed in place. After the new package
passes the public-install smoke, deprecate `tower-studio` with a message that
points to `npm install -g @tower-org/cli`. Do not deprecate it before the new
package is usable.

## Repository and package metadata

All package manifests use `https://github.com/tower-org/tower` for repository,
homepage, and issues. The public root package enforces npmjs.org, public scoped
access, and provenance in `publishConfig`. Workspace packages remain in this
monorepo and keep their existing private/public boundary.

## Release control points

`pnpm release` is verification-only. It runs the fixed identity gate, build,
package canary, release-entrypoint policy, and `npm pack --dry-run`. It never
publishes, tags, pushes, or creates a GitHub Release.

Publishing requires all of the following:

1. The repository has been transferred and `origin` resolves to
   `tower-org/tower`.
2. The worktree is clean and the fixed package matrix passes.
3. `TOWER_RELEASE_APPROVED` exactly equals `@tower-org/cli@0.3.0`.
4. The public registry does not already contain that exact version.
5. npm authentication is supplied externally; no credential file is read or
   committed by the release scripts.

The GitHub Actions workflow adds an `npm-production` environment approval,
the repository variable `NPM_RELEASE_ENABLED=true`, exact manual input, and the
`NPM_TOKEN` secret. It grants only `contents: read` and `id-token: write` and
publishes with public access and provenance. Tagging, pushing, and GitHub
Release creation remain separate signed operations.

## Post-publication acceptance

The release is not complete until a clean temporary npm prefix installs
`@tower-org/cli@0.3.0` from the public registry, the installed `tower` reports
`tower v0.3.0`, first-run migrations complete in an isolated `TOWER_DATA_DIR`,
and the server answers on a dynamically allocated `127.0.0.1` port. The smoke
must stop the temporary process and delete all temporary files without touching
the user's `~/.tower` or port 3000.
