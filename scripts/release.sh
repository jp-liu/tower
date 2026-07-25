#!/usr/bin/env bash
#
# Tower 一键发布脚本
#
#   ./scripts/release.sh            # patch 版本 (0.3.0 -> 0.3.1)
#   ./scripts/release.sh minor      # minor 版本 (0.3.0 -> 0.4.0)
#   ./scripts/release.sh major      # major 版本 (0.3.0 -> 1.0.0)
#   ./scripts/release.sh 0.3.5      # 指定版本号
#   ./scripts/release.sh --no-push  # 发布后只在本地 commit + tag，不 push
#
# 流程: 检查干净 -> pull -> bump 版本 -> 修 esbuild shim -> build -> 包结构门禁 -> npm publish -> commit -> tag -> push
#
# 内置约定 (可用环境变量覆盖):
#   RELEASE_PROXY     发布代理        可选; 留空则沿用当前 shell/npm 环境
#   RELEASE_REGISTRY  发布 registry   默认 https://registry.npmjs.org/  (项目默认 registry 是内网源, 必须覆盖)
#
set -euo pipefail

cd "$(dirname "$0")/.."

PROXY="${RELEASE_PROXY:-}"
REGISTRY="${RELEASE_REGISTRY:-https://registry.npmjs.org/}"

BUMP="patch"
PUSH=1
for arg in "$@"; do
  case "$arg" in
    --push) PUSH=1 ;;               # 向后兼容；push 现已是默认行为
    --no-push) PUSH=0 ;;
    patch|minor|major) BUMP="$arg" ;;
    [0-9]*) BUMP="$arg" ;;          # 显式版本号
    *) echo "✗ 未知参数: $arg" >&2; exit 1 ;;
  esac
done

step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$1"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }
with_optional_proxy() {
  if [ -n "$PROXY" ]; then
    HTTP_PROXY="$PROXY" HTTPS_PROXY="$PROXY" http_proxy="$PROXY" https_proxy="$PROXY" "$@"
  else
    "$@"
  fi
}

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

# --- 6. 校验实际待发布包结构 ---
step "pnpm release:pack:check"
pnpm release:pack:check

# --- 7. 发布 (覆盖大小写代理变量 + 公共 registry) ---
step "npm publish ($NEW_VER -> $REGISTRY)"
with_optional_proxy npm publish --registry "$REGISTRY"

# --- 8. 提交 release ---
step "git commit"
git add package.json
git commit -m "chore(release): $NEW_VER"
echo "  已提交 chore(release): $NEW_VER"

# --- 9. 打 git tag (指向 release commit) ---
step "git tag v$NEW_VER"
if git rev-parse "v$NEW_VER" >/dev/null 2>&1; then
  die "tag v$NEW_VER 已存在, 请检查 (可能上次发布残留)"
fi
git tag -a "v$NEW_VER" -m "tower-studio v$NEW_VER"
echo "  已打 tag v$NEW_VER"

# --- 10. 默认 push (含 tag) ---
if [ "$PUSH" -eq 1 ]; then
  step "git push (含 tag)"
  git push
  git push origin "v$NEW_VER"
fi

printf '\n\033[1;32m✓ 发布完成: tower-studio@%s\033[0m\n' "$NEW_VER"
# 注意: 不要用 `[ ... ] && echo` 作为脚本最后一条命令 —— 条件为假时它返回 1,
# 会让整个脚本以退出码 1 结束 (假失败), 即便发布全部成功.
if [ "$PUSH" -eq 0 ]; then
  echo "  (--no-push: 未推送，需要时手动执行 git push && git push origin v$NEW_VER)"
fi
exit 0
