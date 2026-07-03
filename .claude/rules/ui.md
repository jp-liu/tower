---
paths:
  - "src/components/**/*.tsx"
  - "src/app/**/*.tsx"
---

# UI Rules

## Component Sizing

- All Button and SelectTrigger use **default size** (`h-8` = 32px). Never use `size="sm"`.
- Inputs, selects, and buttons that sit side by side must use the same height.

## Card / Container Backgrounds

- 卡片 / 区块容器**必须带背景色 `bg-card`**（灰底），不要只写 `border` 不写 `bg-*` —— 透明容器在纯黑页面背景下几乎只剩边框、看不清、没分量。
- 参考：设置页 Extensions 卡片、Prompts 内置/自定义区块都用 `rounded-xl border bg-card p-4`。
- 容器内再嵌的小提示 / 代码预览块用 `bg-muted/30` 与外层区分。

## 文件预览（图片 + 文本，全局统一）

- **全局所有"点击文件看内容"只用资源页那一套两件，禁止再自建第三套**（不许 `<img>` 点击放大、`<a target="_blank">` 新标签打开、或另起 modal/Dialog）：
  - 图片 → `src/components/assets/image-lightbox.tsx` 的 `ImageLightbox`：滚轮缩放（0.1×–8×）、拖拽平移、键盘（Esc/←→/+−/0）、缩放百分比 + 复位、多图画廊，`createPortal` 全屏 overlay。
  - 文本 → `src/components/assets/text-preview-dialog.tsx` 的 `TextPreviewDialog`：内部 `fetch(url)` 自己加载，`md` 走 Streamdown、`json` 美化、其余纯文本，1MB 上限。
- 两者 props 形状一致，都传 url：`imageUrl|url / filename / open / onOpenChange`。
  ```tsx
  <ImageLightbox imageUrl={url} filename={name ?? ""} open={url !== null}
    onOpenChange={(o) => { if (!o) setUrl(null); }} />
  <TextPreviewDialog url={url} filename={name} open={url !== null}
    onOpenChange={(o) => { if (!o) setUrl(null); }} />
  ```
- 类型分派各调用点自行 mount 对应组件（现状：assets-page / task-overview-drawer / task-notes-panel / assistant-chat 都是各自挂）。判定：图片以 `isImageAsset(filename, mimeType)`（`@/lib/file-serve-client`）为准，其余可读文本交给 `TextPreviewDialog`。**支持类型以这两件组件为唯一口径，不要在各调用点再各写一套扩展名白名单。**
- 已接入：资源页、任务笔记、任务概览抽屉、助手聊天区（图片 + 文本）。新增预览需求直接引这两件，不复制第二套。

## Dialog (shadcn)

- `DialogContent` ships with `sm:max-w-sm` (≈ 384px) baked into its default class list.
- Any wider dialog **MUST** use the `sm:` prefix — otherwise the default wins on `≥ 640px` screens and the dialog stays at 384px.
  ```tsx
  // ✗ Wrong — sm:max-w-sm overrides this on desktop
  <DialogContent className="max-w-3xl">

  // ✓ Right
  <DialogContent className="sm:max-w-3xl">

  // ✓ Or fully escape the default
  <DialogContent className="w-[min(960px,92vw)] max-w-none sm:max-w-none">
  ```
- Past offenders: `image-lightbox.tsx` (rebuilt as portal overlay), `text-preview-dialog.tsx`.

## Select (Base UI)

- **Never use `<SelectValue />`** — it renders the raw `value` (ID), not the display name.
- Use a manual `<span>` inside `<SelectTrigger>` to show the selected item's name:
  ```tsx
  <SelectTrigger>
    <span className="truncate">{items.find(x => x.id === value)?.name ?? value}</span>
  </SelectTrigger>
  ```
- `SelectContent` defaults: `alignItemWithTrigger=false`, `align="start"` — dropdown below trigger, left-aligned.
- Never use native `<select>/<option>` — always use the shadcn Select component.

## Toast

- Use **Sonner** (`import { toast } from "sonner"`).
- API: `toast.success("msg")` / `toast.error("msg")` / `toast.info("msg")`
- `<Toaster richColors position="top-right" />` is in layout.tsx.

## Loading States

- Never insert/remove loading text that causes layout shift.
- Use opacity overlay + spinner on the content area:
  ```tsx
  <div className={`relative ${isPending ? "opacity-40 pointer-events-none" : ""}`}>
    {isPending && <Loader2 className="absolute inset-0 m-auto size-5 animate-spin" />}
    {children}
  </div>
  ```

## i18n

- `I18nProvider` starts with `"zh"` on both server and client (avoids hydration mismatch).
- Locale is read from localStorage in `useEffect` after mount.
- All user-facing strings must use `t("key")` from `useI18n()`.

## Buttons — 统一使用 `<Button>` 组件

**禁止在可交互按钮场景使用原生 `<button>` + 手写 hover 样式。** 必须使用 `<Button>` 组件，通过 `variant` 和 `size` 控制样式。

### Icon Buttons（工具栏 / 头部 / 面板）

```tsx
<Button variant="ghost" size="icon" className="text-muted-foreground">
  <Icon className="h-4 w-4" />
</Button>
```

### Text Buttons（带文字的操作按钮）

```tsx
<Button variant="ghost" className="text-muted-foreground">
  <Icon className="h-3.5 w-3.5" />
  <span className="text-xs">{label}</span>
</Button>
```

### 规则

- **Always use `<Button>`** — ghost 变体的 hover 样式（`hover:bg-accent`）在 light/dark 下统一生效
- **Never use `<button>` + 手写 `hover:bg-*`** — 容易和 Button 组件不一致，dark 模式下可能看不见
- `variant="ghost"` 用于工具栏、头部、面板内的非主要操作
- `variant="outline"` 用于次要操作（取消、返回等）
- `variant="default"` 用于主要操作（创建、提交等）
- 只在特殊场景用原生 `<button>`：右键菜单项、自定义交互组件内部等

## Header Heights

Standardized header/toolbar heights. **Panels on the same horizontal line MUST use the same level.**

| Level | Utility Class | Height | Usage |
|-------|--------------|--------|-------|
| 1 | `header-xs` | 36px | Inner sub-tabs (Files/Search/Git) |
| 2 | `header-sm` | 44px | Action bars, simple toolbars |
| 3 | `header-md` | 56px | Main tab bars (Files/Changes/Preview), page nav |
| 4 | `header-lg` | 72px | Page headers (title + status, two lines) |
| 5 | `header-xl` | 88px | Page headers with actions (title + status + buttons) |

Each utility sets `min-height` + `border-bottom`. Combine with padding classes as needed:

```tsx
{/* Left panel header — level 4 */}
<div className="header-lg px-4 py-3 flex items-center">...</div>

{/* Right panel tab bar — must also be level 4 to align */}
<div className="header-lg px-3 py-3 flex items-center">...</div>
```

CSS variables available: `var(--header-xs)` through `var(--header-xl)`.

## DnD Kit

- Always pass a stable `id` prop to `<DndContext>` to prevent hydration mismatch.
