---
title: 发布流程
description: Candidate、正式发布、产物校验与失败恢复
---

# 发布流程

Tower 的正式发布以一个已经推送、不可移动的 `v<version>` tag 为唯一身份。候选构建只生成可下载的验证产物，不创建 tag、不发布 npm，也不创建 GitHub Release。

## 发布通道

| 通道 | 入口 | 输出 |
|---|---|---|
| Release Candidate | 手动运行 `release-candidate.yml` | 五个平台的 portable 包、manifest、npm pack、校验和、Candidate 元数据和说明；仅作为 workflow artifact |
| 正式 Release | 推送与包版本一致的 `v<version>` tag | 带 provenance 的 npm 包、GitHub Release、portable 包、安装器、`SHA256SUMS`、`CHANGELOG.md` |

## 正式发布顺序

1. 合并版本与 changelog，推送后取得绿色 CI。
2. 确认 release tag ruleset 已限制 `v*` tag 的更新和删除，并启用 Immutable Releases。
3. 在最终提交创建 annotated tag，并推送该 tag。只有 `v数字.数字.数字` 会触发正式 workflow。
4. `release.yml` 自动取得 tag 与包身份；`prepare` 再校验 tag 必须等于 `v<package.version>`、必须指向当前提交，然后运行 build、pack、smoke 与文档门禁。
5. 五个平台分别构建 portable 包，并在 Node.js 22/24 下进行断网 smoke。
6. `assemble` 只接受完整且 commit/version 一致的产物，生成校验和与 Release notes。
7. 流水线到达 `npm-production` 后暂停；GitHub 按通知设置提醒已配置的审核人。审核通过后只校验前面生成的 npm 包，不重复构建，再发布 npm 并创建或恢复 GitHub Release 草稿。
8. 上传并逐项校验所有附件；只有附件完整时才公开 Release。公开后由 Immutable Releases 锁定 tag 与附件。

`workflow_dispatch` 只保留作同一受保护 tag 的失败恢复入口，不是日常发布入口。

## 产物契约

每个正式 Release 包含五个平台包、三个安装入口、npm pack 原件、`SHA256SUMS` 和 `CHANGELOG.md`。GitHub 自动生成的 Source code 压缩包不是 Tower 安装包。

发布脚本不会覆盖同名但内容不同的远端资产，也不会修改内容不同的既有 Release notes。npm 已成功但 GitHub 上传中断时，恢复流程会比较 npm registry 的 `dist.integrity` 与本次已验证 tarball；只有字节完全一致才继续补齐 GitHub Release。不得复用版本或移动 tag。tag ruleset 保护发布前的 tag，Immutable Releases 保护公开后的 tag 与附件，两者承担不同阶段的防线。

## 本地边界

`pnpm release:prepare` 用于本地预检。正式 npm provenance 依赖 GitHub Actions 的 OIDC（OpenID Connect）身份，本地发布不是恢复路径。外部发布仍需要明确授权；运行本地门禁不会 push、tag 或发布任何内容。

版本变化记录以 [CHANGELOG](/guide/changelog) 为准，安装和回滚见 [安装与运行](/guide/getting-started)。
