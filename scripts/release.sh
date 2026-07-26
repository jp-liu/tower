#!/usr/bin/env bash
# Tower release entrypoint. The default mode performs local gates and a pack
# dry-run only. Publishing requires an exact approval value and canonical remote.
set -euo pipefail

cd "$(dirname "$0")/.."

REGISTRY="https://registry.npmjs.org/"
PUBLISH=0

for arg in "$@"; do
  case "$arg" in
    --publish) PUBLISH=1 ;;
    --dry-run) PUBLISH=0 ;;
    *) printf 'Unknown argument: %s\n' "$arg" >&2; exit 1 ;;
  esac
done

step() { printf '\n==> %s\n' "$1"; }
die() { printf 'Release blocked: %s\n' "$1" >&2; exit 1; }

PACKAGE_NAME="$(node -p "require('./package.json').name")"
PACKAGE_VERSION="$(node -p "require('./package.json').version")"
APPROVAL="${TOWER_RELEASE_APPROVED:-}"

step "Validate release configuration"
node scripts/release-gate.js --registry "$REGISTRY"

step "Build and validate release package"
pnpm release:prepare

step "Run npm pack dry-run against the public registry"
PACK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/tower-release-pack.XXXXXX")"
trap 'rm -rf "$PACK_DIR"' EXIT
npm pack --dry-run --json --pack-destination "$PACK_DIR" --registry "$REGISTRY" >/dev/null
printf 'Pack dry-run passed: %s@%s\n' "$PACKAGE_NAME" "$PACKAGE_VERSION"

if [ "$PUBLISH" -eq 0 ]; then
  printf '\nRelease is ready locally. No package, tag, commit, or remote was changed.\n'
  exit 0
fi

step "Validate explicit publication approval"
EXPECTED_APPROVAL="${PACKAGE_NAME}@${PACKAGE_VERSION}"
[ "$APPROVAL" = "$EXPECTED_APPROVAL" ] || die "set TOWER_RELEASE_APPROVED=$EXPECTED_APPROVAL after final approval"
[ -z "$(git status --porcelain)" ] || die "the worktree must be clean before publication"

REMOTE_URL="$(git remote get-url origin 2>/dev/null || true)"
case "$REMOTE_URL" in
  git@github.com:tower-org/tower.git|https://github.com/tower-org/tower|https://github.com/tower-org/tower.git) ;;
  *) die "origin must point to tower-org/tower before publication (got ${REMOTE_URL:-none})" ;;
esac

if npm view "$EXPECTED_APPROVAL" version --registry "$REGISTRY" >/dev/null 2>&1; then
  die "$EXPECTED_APPROVAL already exists on the public registry"
fi

step "Publish scoped public package with provenance"
npm publish --access public --provenance --registry "$REGISTRY"

printf '\nPublished %s. Git tag, push, and GitHub Release remain separate approved operations.\n' "$EXPECTED_APPROVAL"
