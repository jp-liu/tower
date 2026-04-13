---
paths:
  - "src/components/**/*.tsx"
  - "src/app/**/*.tsx"
---

# UI Rules

## Component Sizing

- All Button and SelectTrigger use **default size** (`h-8` = 32px). Never use `size="sm"`.
- Inputs, selects, and buttons that sit side by side must use the same height.

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

## DnD Kit

- Always pass a stable `id` prop to `<DndContext>` to prevent hydration mismatch.
