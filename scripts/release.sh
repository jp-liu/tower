#!/usr/bin/env bash
#
# Tower 一键发布脚本
#
#   ./scripts/release.sh            # patch 版本 (0.2.38 -> 0.2.39)
#   ./scripts/release.sh minor      # minor 版本 (0.2.38 -> 0.3.0)
#   ./scripts/release.sh major      # major 版本 (0.2.38 -> 1.0.0)
#   ./scripts/release.sh 0.3.5      # 指定版本号
#   ./scripts/release.sh --push     # 发布后顺带 git push
#   ./scripts/release.sh patch --push
#
# 流程: 检查干净 -> pull -> bump 版本 -> 修 esbuild shim -> build -> npm publish -> 校验 -> commit
#
# 内置约定 (可用环境变量覆盖):
#   RELEASE_PROXY     发布代理        默认 http://127.0.0.1:7897  (本地 Clash; 切勿用 31165, 会重置大 PUT)
#   RELEASE_REGISTRY  发布 registry   默认 https://registry.npmjs.org/  (项目默认 registry 是内网源, 必须覆盖)
#
set -euo pipefail

cd "$(dirname "$0")/.."

PROXY="${RELEASE_PROXY:-http://127.0.0.1:7897}"
REGISTRY="${RELEASE_REGISTRY:-https://registry.npmjs.org/}"

BUMP="patch"
PUSH=0
for arg in "$@"; do
  case "$arg" in
    --push) PUSH=1 ;;
    patch|minor|major) BUMP="$arg" ;;
    [0-9]*) BUMP="$arg" ;;          # 显式版本号
    *) echo "✗ 未知参数: $arg" >&2; exit 1 ;;
  esac
done

step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$1"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# --- 1. 前置检查: 工作区必须干净, 否则 release commit 会混入杂物 ---
step "检查工作区状态"
if [ -n "$(git status --porcelain)" ]; then
  git status --short
  die "工作区有未提交改动, 请先提交或 stash 再发布"
fi
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "  分支: $BRANCH (干净)"

# --- 2. pull 最新 ---
step "git pull --ff-only"
git pull --ff-only

# --- 3. bump 版本 (只改 package.json, 不打 git tag) ---
step "bump 版本 ($BUMP)"
OLD_VER="$(node -p "require('./package.json').version")"
npm version "$BUMP" --no-git-tag-version >/dev/null
NEW_VER="$(node -p "require('./package.json').version")"
echo "  $OLD_VER -> $NEW_VER"

# --- 4. 修复 esbuild shim (worktree 残留会让 .bin/esbuild 指向仓库外) ---
step "校验 esbuild"
if ! node_modules/.bin/esbuild --version >/dev/null 2>&1; then
  echo "  esbuild shim 损坏, 重建符号链接"
  REAL_ESBUILD="$(ls -d node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild 2>/dev/null | head -1)"
  [ -n "$REAL_ESBUILD" ] || die "找不到 esbuild 二进制 (node_modules/.pnpm/esbuild@*), 请先 pnpm install"
  ln -sf "../${REAL_ESBUILD#node_modules/}" node_modules/.bin/esbuild
  node_modules/.bin/esbuild --version >/dev/null 2>&1 || die "esbuild 仍不可用"
fi
echo "  esbuild $(node_modules/.bin/esbuild --version) OK"

# --- 5. 构建 ---
step "pnpm build"
pnpm build

# --- 6. 发布 (覆盖大小写代理变量 + 公共 registry) ---
step "npm publish ($NEW_VER -> $REGISTRY)"
HTTP_PROXY="$PROXY" HTTPS_PROXY="$PROXY" http_proxy="$PROXY" https_proxy="$PROXY" \
  npm publish --registry "$REGISTRY"

# --- 7. 校验线上版本 ---
step "校验线上版本"
LATEST="$(HTTPS_PROXY="$PROXY" https_proxy="$PROXY" npm view tower-studio version --registry "$REGISTRY" 2>&1)"
[ "$LATEST" = "$NEW_VER" ] || die "线上版本 ($LATEST) 与预期 ($NEW_VER) 不符"
echo "  npm latest = $LATEST ✓"

# --- 8. 提交 release ---
step "git commit"
git add package.json
git commit -m "chore(release): $NEW_VER"
echo "  已提交 chore(release): $NEW_VER"

# --- 9. (可选) push ---
if [ "$PUSH" -eq 1 ]; then
  step "git push"
  git push
fi

printf '\n\033[1;32m✓ 发布完成: tower-studio@%s\033[0m\n' "$NEW_VER"
[ "$PUSH" -eq 0 ] && echo "  (未 push, 需要时手动 git push 或加 --push)"
