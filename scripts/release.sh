#!/usr/bin/env bash
# Tower release entrypoint. The default mode performs local gates and a pack
# dry-run only. Publishing requires an exact approval value and canonical remote.
set -euo pipefail

cd "$(dirname "$0")/.."

REGISTRY="https://registry.npmjs.org/"
PUBLISH=0
PACKAGE_TARBALL=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --publish) PUBLISH=1; shift ;;
    --dry-run) PUBLISH=0; shift ;;
    --tarball) [ "$#" -ge 2 ] || { printf '%s\n' 'Release blocked: --tarball requires a path' >&2; exit 1; }; PACKAGE_TARBALL=$2; shift 2 ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; exit 1 ;;
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
[ -n "${TOWER_RELEASE_TAG:-}" ] || die "TOWER_RELEASE_TAG is required for publication"
[ -n "${TOWER_RELEASE_COMMIT:-}" ] || die "TOWER_RELEASE_COMMIT is required for publication"
node scripts/release-context.js --tag "$TOWER_RELEASE_TAG" --confirmation "$APPROVAL"
[ -z "$(git status --porcelain)" ] || die "the worktree must be clean before publication"

REMOTE_URL="$(git remote get-url origin 2>/dev/null || true)"
case "$REMOTE_URL" in
  git@github.com:tower-org/tower.git|https://github.com/tower-org/tower|https://github.com/tower-org/tower.git) ;;
  *) die "origin must point to tower-org/tower before publication (got ${REMOTE_URL:-none})" ;;
esac

NPM_VIEW_ERROR="$PACK_DIR/npm-view-error.log"
if npm view "$EXPECTED_APPROVAL" version --registry "$REGISTRY" >/dev/null 2>"$NPM_VIEW_ERROR"; then
  if ! PUBLISHED_COMMIT="$(npm view "$EXPECTED_APPROVAL" gitHead --registry "$REGISTRY" 2>"$NPM_VIEW_ERROR")"; then
    die "could not verify the existing npm publication; refusing to continue"
  fi
  [ "$PUBLISHED_COMMIT" = "$TOWER_RELEASE_COMMIT" ] || die "$EXPECTED_APPROVAL exists with gitHead ${PUBLISHED_COMMIT:-missing}, expected $TOWER_RELEASE_COMMIT"
  printf '\nVerified existing npm publication %s at %s; continuing safe release repair.\n' "$EXPECTED_APPROVAL" "$PUBLISHED_COMMIT"
  exit 0
elif grep -Eq '(^|[[:space:]])E404([[:space:]]|$)|404 Not Found' "$NPM_VIEW_ERROR"; then
  printf 'Confirmed %s is absent from npm.\n' "$EXPECTED_APPROVAL"
else
  die "could not prove $EXPECTED_APPROVAL is absent from npm; refusing to publish"
fi

step "Publish scoped public package with provenance"
if [ -n "$PACKAGE_TARBALL" ]; then
  [ -f "$PACKAGE_TARBALL" ] || die "release tarball not found: $PACKAGE_TARBALL"
  npm publish "$PACKAGE_TARBALL" --access public --provenance --registry "$REGISTRY"
else
  npm publish --access public --provenance --registry "$REGISTRY"
fi

printf '\nPublished %s. No tag or push was performed.\n' "$EXPECTED_APPROVAL"
