# Tower next-release readiness

Date: 2026-08-05

## Decision

Status: **not authorized and not ready for external publication**.

The release implementation is locally ready for a final CI candidate, but a
real release remains blocked on an OWNER version/date/go-no-go decision, an
immutable `v*` tag policy, and native CI evidence for all five targets. No npm
publication, tag creation or push, workflow dispatch, GitHub Release creation,
or asset upload was performed during this audit.

Recommended next version: **`0.4.0`**. This is a recommendation, not a committed
version decision.

## Audited identity

- Published package manifest remains `@tower-org/cli@0.3.1`.
- Existing annotated tag `v0.3.1` resolves locally and remotely to commit
  `de50aeb7ff831c48f3287100a36d9e99dfb493b0`.
- npm reports `@tower-org/cli@0.3.1` with the same `gitHead`.
- Audit input was local `main` commit
  `a4aff39c8423994611cc62247761368ea9a48923`.
- Release-hardening fixes are commit
  `574201966905ee96a4669f92ba2851e00b3a2e61` on the isolated task branch.
- At audit start, local `main` was two commits ahead of
  `origin/main@26456f565931c006b322caee947c60da573bbd08`. Local presence is not
  evidence of remote publication. The release-hardening commit is also local
  until the task branch is reviewed and merged.

No release candidate tag exists for the recommended version. `package.json`,
lockfiles, release gates, and published-smoke commands intentionally remain at
`0.3.1` pending OWNER approval.

## SemVer evidence

`v0.3.1..a4aff39` contains compatible user-visible features as well as fixes:

- `c032619` adds registry-free portable installation for five OS/CPU targets,
  checksums, offline smoke, installers, and GitHub Release publication.
- `491e430` adds assistant session-origin behavior and changes the default
  visibility of Gateway discussions.
- `3233934`, `29a4580`, and `4f5da54` harden visible Workbench recovery and
  restored-session behavior.
- `7ff97fb` and `a4aff39` complete unattended goal deactivation and final OWNER
  notification/recovery behavior, including new UI states.

These are additive capabilities, not only defect corrections, and no
intentional incompatible public API change was found. Under SemVer, the
smallest honest increment is therefore MINOR: `0.3.1` to `0.4.0`. Choose
`0.3.2` only if the project explicitly classifies all of these already-merged
features as previously shipped behavior; the repository diff does not support
that classification.

## Workflow audit

The release workflow now binds one identity across:

- the dispatch ref (`refs/tags/v<package version>`);
- `GITHUB_SHA`;
- `GITHUB_WORKFLOW_SHA`;
- the local tag target;
- `TOWER_RELEASE_COMMIT`;
- `package.json` name/version; and
- the exact human confirmation string.

This prevents dispatching from a same-commit branch while supplying a tag as a
separate unbound input. GitHub documents `workflow_dispatch` SHA/ref behavior
and preserves the same SHA/ref on reruns:

- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch
- https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs

Verified workflow properties:

- default permission is `contents: read`; only the protected publish job gains
  `contents: write` and `id-token: write`;
- npm publish uses a GitHub-hosted runner and `--provenance`, matching npm's
  documented provenance prerequisites;
- `npm-production` exists, has a required OWNER reviewer, disallows admin
  bypass, and currently allows self-review;
- repository variable `NPM_RELEASE_ENABLED=true` and secret name `NPM_TOKEN`
  exist (secret validity was not and cannot be proved without publication);
- official runner labels currently cover `macos-14`, `macos-15-intel`,
  `ubuntu-24.04`, `ubuntu-24.04-arm`, and `windows-2022`:
  https://docs.github.com/en/actions/reference/runners/github-hosted-runners;
- five portable jobs must all succeed before assembly; assembly requires one
  manifest and asset per target, the exact source commit, one npm tarball,
  installers, generated release notes, and `SHA256SUMS`;
- each target runs offline smoke on Node 22 and Node 24 before artifact upload;
- concurrency is serialized as `production-release` without cancellation;
- run artifacts are retained for seven days. Same-run repair is supported
  within that window; after expiry, start a new dispatch against the unchanged
  protected tag rather than trying to reconstruct missing artifacts manually.

External configuration blocker: the repository currently reports no rulesets.
Before publication, add a ruleset that prevents updates and deletion of release
tags matching `v*` except through an explicit emergency process. Runtime gates
detect a moved tag before npm/GitHub operations, but they cannot make a tag
immutable after the workflow finishes.

## Recovery matrix

| Starting state | Behavior | Safe continuation |
| --- | --- | --- |
| npm version absent | Publish only after npm explicitly returns `E404`; network/auth ambiguity stops | Retry the same workflow after resolving registry access |
| npm version exists, same `gitHead` | Reuse it without republishing | Continue to GitHub Release repair |
| npm version exists, different/missing `gitHead` | Stop | Investigate; never reuse the version for another commit |
| Release absent after npm succeeds | Verify remote tag commit, create Release, upload assets | Rerun safely if an upload later fails |
| Release exists with exact notes and partial assets | Reuse checksum-identical assets and upload missing names | Rerun the same workflow |
| Existing asset has same name and same SHA-256 | Reuse | No mutation required |
| Existing asset has same name but different content | Stop without overwrite | Investigate and choose a new version/tag if content is wrong |
| Existing Release notes differ | Stop without editing | Investigate identity; do not silently replace release history |
| npm succeeds, GitHub creation/upload fails | npm is immutable but exact `gitHead` is recognized on rerun | Rerun within artifact retention to repair GitHub only |
| A Release exists before npm, then npm fails | Workflow does not create this order itself; it stops before GitHub mutation | Fix npm, rerun, then reconcile the pre-existing Release by exact notes/checksums |
| Remote tag moved | Context or GitHub publisher stops | Restore the reviewed protected tag; do not publish against the moved ref |

Automated tests cover npm exact reuse/conflict/absence/ambiguous lookup/publish
failure; annotated remote-tag peeling; Release creation; partial repair;
checksum reuse/conflict; notes conflict; and moved-tag refusal.

## Local verification

Passed from the isolated worktree:

- `pnpm db:generate` followed by `pnpm exec tsc --noEmit --pretty false`;
- `pnpm release:prepare`, including the Next.js production build, one dedicated
  Playwright release smoke, package canary, entrypoint check, and install-doc
  check;
- package canary: 2,319 files and 45,120,454 unpacked bytes;
- seven release-focused test files: 41 tests passed;
- exact ESLint for changed JavaScript/TypeScript files;
- YAML syntax parsing and a read-only remote annotated-tag resolution check.

Real current-platform evidence from commit `5742019` on Node `24.18.0`:

- npm tarball: 10,927,263 bytes, SHA-256
  `ad683d24518e189a6c6aa73273b0429a033ebedaef486d32d35838c1b80e5b61`;
- `tower-portable-darwin-arm64.tar.gz`: 118,388,392 bytes, SHA-256
  `25ba7411e7d87e5901c3b61edac2b751a306a946aa2a585cd9200d7cdefc0667`;
- portable canary: 13,298 files;
- offline smoke: first start, schema upgrade, 36 migrations, Prisma Client and
  engines, MCP, node-pty, ripgrep, service boundary, and zero npm/Prisma CDN
  requests.

One portable rebuild attempt encountered `ECONNRESET` during build-time
`npm ci`; a fail-fast retry succeeded. This was a dependency-fetch failure
before asset creation, not an offline-runtime request.

Known non-blocking warning: Next/Turbopack reports the existing broad
filesystem tracing warnings from `next.config.ts`; production build and release
smoke complete successfully.

## Evidence still missing

Local macOS arm64 evidence must not be generalized. The following require a
real GitHub Actions run against the final tagged commit:

- macOS x64 on `macos-15-intel` with Node 22 and 24;
- Linux x64 on `ubuntu-24.04` with Node 22 and 24;
- Linux arm64 on `ubuntu-24.04-arm` with Node 22 and 24;
- Windows x64 on `windows-2022` with Node 22 and 24;
- a second macOS arm64 Node 22 smoke (local verification used Node 24);
- five-target artifact assembly and generated cross-platform checksums;
- actual npm provenance attestation;
- actual GitHub Release creation/upload and post-publication installer download;
- `pnpm release:smoke:published` against the newly published exact version.

## Documentation and asset contract

The English and Chinese installation guides and README entrypoints agree with
the generated asset names:

- `tower-portable-darwin-arm64.tar.gz`
- `tower-portable-darwin-x64.tar.gz`
- `tower-portable-linux-arm64.tar.gz`
- `tower-portable-linux-x64.tar.gz`
- `tower-portable-windows-x64.tar.gz`
- `install.sh`, `install.ps1`, `SHA256SUMS`, and the exact npm pack tarball

The online base is
`https://github.com/tower-org/tower/releases/download/v<VERSION>` (or the
`latest/download` alias). Both installer implementations require HTTPS online,
support an offline asset directory, validate SHA-256, reject target/version
mismatches, provide rollback and uninstall, and preserve `~/.tower` user data.
Generated Release notes now include the versioned download base, verification,
version pinning, rollback, uninstall, Node policy, and maintained guide links.

## Shortest authorized release path

1. Review and merge the release-hardening commit; push the final reviewed
   candidate so the remote default branch contains the exact workflow.
2. Add and verify the immutable `v*` tag ruleset.
3. OWNER decides version, release date, and go/no-go. Recommendation: `0.4.0`.
4. In one version-bump commit, update the root/package lock version, fixed
   release gate matrix, published-smoke spec, installation examples, and final
   bilingual release notes. Run `pnpm release:prepare` on a clean worktree.
5. After a separate OWNER authorization, create and push the annotated tag on
   that exact commit.
6. After a separate OWNER authorization, dispatch `.github/workflows/release.yml`
   with ref `v<version>`, tag `v<version>`, and confirmation
   `@tower-org/cli@<version>`; approve `npm-production` only after all prepare,
   native portable, and assembly jobs are green.
7. Verify npm version plus provenance, GitHub Release notes, all eight immutable
   downloadable files, and `SHA256SUMS`; then run the exact published-package
   smoke and one installer download per practical platform.

## Rollback points

- Before npm publish: reject the environment approval or cancel; no public
  package or Release exists.
- After npm publish but before complete GitHub assets: do not republish. Rerun
  the same workflow; exact `gitHead`, notes, and checksums drive repair.
- After a bad immutable npm version: deprecate it and issue a corrective new
  version. Do not move/reuse the tag or overwrite conflicting assets.
- Client installation: `--rollback` switches to the previous installed payload;
  `--uninstall` removes application files while retaining user data.
