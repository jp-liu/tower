---
title: Release process
description: Candidate builds, production publication, asset verification, and recovery
---

# Release process

A production Tower release is identified by one already-pushed, immutable `v<version>` tag. Candidate builds create downloadable verification artifacts only. They do not create tags, publish npm, or create a GitHub Release.

## Channels

| Channel | Entry point | Output |
|---|---|---|
| Release Candidate | Manually run `release-candidate.yml` | Five portable targets, manifests, npm pack, checksums, Candidate metadata, and notes as workflow artifacts only |
| Production Release | Manually run `release.yml` from the target tag | npm with provenance, GitHub Release, portable archives, installers, `SHA256SUMS`, and `CHANGELOG.md` |

## Production sequence

1. Merge the version and changelog, push, and obtain green CI.
2. Verify that the release-tag ruleset restricts updates and deletion of matching `v*` tags, and enable Immutable Releases.
3. Create and push an annotated tag on the final commit.
4. Dispatch `release.yml` from that tag with the exact tag and `@tower-org/cli@<version>` confirmation.
5. `prepare` binds tag, commit, package version, repository, and approval before build, pack, smoke, and documentation gates.
6. Five native runners build portable archives and run offline smoke on Node.js 22 and 24.
7. `assemble` accepts only complete artifacts with matching commit and version, then emits checksums and release notes.
8. After `npm-production` review, publish npm and create or resume the GitHub Release draft.
9. Upload and verify every asset, then publish the Release only when the asset set is complete. Immutable Releases locks the tag and assets after publication.

## Asset contract

Every production Release includes five portable archives, three installer entry points, the exact npm pack input, `SHA256SUMS`, and `CHANGELOG.md`. GitHub's automatic source archives are not Tower installers.

The publisher never overwrites a same-name asset with different bytes and never edits conflicting existing release notes. If npm succeeds but GitHub upload stops, rerun the workflow for the same tag while artifacts are retained and resume the unpublished draft. Never reuse the version or move the tag. The tag ruleset protects the pre-publication window; Immutable Releases protects the published tag and assets.

## Local boundary

`pnpm release:prepare` is the local preflight. npm provenance depends on the GitHub Actions OIDC (OpenID Connect) identity, so local publication is not a recovery path. External publication still requires explicit authorization; local gates never push, tag, or publish.

See the [Changelog](/en/guide/changelog) for version history and [Install and run](/en/guide/getting-started) for installation and rollback.
