# 全局快捷键系统 + Missions 窗格切换 — 设计规格

**Date:** 2026-06-15
**Status:** Approved (待实现)
**Scope:** Missions 窗格键盘导航为核心 + 轻量可扩展全局快捷键框架 + 命令面板 + 帮助面板

---

## 1. 目标

1. 引入 `tinykeys`（轻量、无依赖）+ 自建注册层，提供统一的快捷键注册/注销、作用域(scope)、冲突处理与帮助(Cheatsheet)面板。
2. **核心痛点**：Missions（Mission Control）多窗格之间用键盘切换焦点并直接输入，无需鼠标点击。
3. 覆盖少量高频全局操作（搜索、命令面板、帮助），其余通过命令面板扩展。

非目标（YAGNI）：用户自定义键位持久化、键位录制、复杂的多级菜单。预留扩展点即可。

---

## 2. 架构总览

```
src/lib/shortcuts/
  types.ts                # ShortcutBinding / RegisteredShortcut / Scope 类型
  shortcut-store.ts       # zustand store：注册表 + register/unregister + 选择器
  shortcut-dispatcher.ts  # 纯函数：根据 registry 构建 tinykeys keymap + 派发/冲突/表单守卫
  shortcut-provider.tsx   # 挂载唯一 window keydown 监听（capture 阶段）
  use-shortcut.ts         # hook：组件生命周期内注册一条/多条绑定
  use-shortcut-help.ts    # hook：读取 registry 供 Cheatsheet 渲染
  shortcut-keys.ts        # 集中定义所有绑定常量（KEYS）+ 默认键位，单一事实来源

src/components/shortcuts/
  shortcut-help-dialog.tsx   # 帮助/Cheatsheet 弹窗（按 scope 分组）
  command-palette.tsx        # 命令面板（复用 cmdk / ui/command.tsx）
  command-palette-provider.tsx # 命令面板开关状态 + 注册 $mod+p 绑定
```

挂载位置：`src/app/layout.tsx`，在 `I18nProvider` 与 `ExtensionProvider`（或 `LayoutClient`）之间包一层 `ShortcutProvider`。命令面板与帮助弹窗在 `LayoutClient` 内挂载（client 边界）。

### 2.1 派发模型（核心）

- **唯一**的 `window` `keydown` 监听，注册在 **capture 阶段**（`{ capture: true }`），确保抢在 xterm 之前拿到事件。
- 监听器由 registry 通过 `tinykeys` 的 `createKeybindingsHandler(keymap)` 构建；registry 变化时重建。
- 同一绑定字符串可被多条目注册（不同 scope）。keymap 的每个 binding → 一个派发闭包：事件触发时收集该 binding 下所有 enabled 条目，按优先级排序取其一执行。

**冲突解决**：scope 特异性 → route scope（如 `missions`）优先于 `global`；同 scope 内按 `priority`（默认 0）降序，再按后注册优先。

**表单守卫（form guard）** — 这是双模式得以「免费」实现的关键：
- 计算 `isFormField(document.activeElement)`：`INPUT` / `TEXTAREA` / `[contenteditable]`（xterm 的 `.xterm-helper-textarea` 命中 `TEXTAREA`）。
- **裸键**（无修饰键，如 `1`、`ArrowLeft`、`Tab`）：当 `isFormField` 为真且条目未设 `allowInInput` 时 **跳过**。→ 终端聚焦（输入模式）时裸键全部进终端。
- **修饰键组合**（含 `$mod` / `Control` / `Meta` / `Alt`）：默认 **绕过** 表单守卫（除非条目显式 `allowInInput: false`）。→ `Cmd+[` / `Cmd+K` 在终端/输入框聚焦时仍生效。
- 命中并执行的条目默认 `event.preventDefault()` + `stopPropagation()`（可用 `preventDefault: false` 关闭）。

---

## 3. 公共 API（契约）

### 3.1 类型（`types.ts`）

```ts
export type ShortcutScope = "global" | "missions" | string;

export interface ShortcutBinding {
  /** tinykeys 语法，如 "$mod+k" | "Control+]" | "1" | "?" 。可为数组绑定多键到同一处理函数 */
  keys: string | string[];
  /** 触发时执行。原始 KeyboardEvent 透传，可读 e.key 区分（用于数字 1-9 复用一个处理器） */
  handler: (event: KeyboardEvent) => void;
  scope?: ShortcutScope;            // 默认 "global"
  /** 用于帮助面板展示的描述（建议传 i18n 文案） */
  description?: string;
  /** 帮助面板分组标题（i18n 文案）；缺省按 scope 分组 */
  group?: string;
  when?: () => boolean;             // 额外启用条件
  allowInInput?: boolean;           // 裸键也想在输入框生效时设 true
  preventDefault?: boolean;         // 默认 true
  priority?: number;                // 默认 0
  /** 是否在帮助面板中隐藏（如内部用绑定） */
  hidden?: boolean;
}

export interface RegisteredShortcut extends ShortcutBinding {
  id: string;          // 自动生成
  keys: string[];      // 归一化为数组
}
```

### 3.2 Hook（`use-shortcut.ts`）

```ts
// 单条
useShortcut("$mod+k", () => openSearch(), { scope: "global", description: t("shortcuts.search") });
// 多条（数组）
useShortcut([
  { keys: ["1","2","3","4","5","6","7","8","9"], handler: onDigit, scope: "missions", description: t("shortcuts.missions.jump") },
  { keys: ["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"], handler: onArrow, scope: "missions", ... },
]);
```

- 在 `useEffect` 内 `register()`，返回 `unregister()` 清理。handler 用 ref 保持最新，避免重复注册。
- 仅当组件挂载时注册 → `MissionsClient` 只在 `/missions` 挂载，天然实现 missions scope 的路由门控。

### 3.3 帮助面板（`use-shortcut-help.ts` + `shortcut-help-dialog.tsx`）

- `useShortcutHelp()` 返回按 group/scope 分组、过滤 `hidden` 后的列表。
- 弹窗触发：`?`（裸键，输入模式下被守卫屏蔽）与 `$mod+/`（任何场景可用）。
- 每条展示：human-readable 键位（`$mod` → ⌘/Ctrl 按平台；`renderKeys()` 工具函数）+ 描述。

---

## 4. Missions 窗格键盘导航（核心交付）

### 4.1 模式

- **导航模式（nav）**：无终端聚焦。窗格上盖半透明遮罩 + hint 数字。
- **输入模式（input）**：某终端聚焦，按键进终端。
- 模式由「是否有终端持有焦点」派生 + 显式 action 设置。`MissionsClient` 持有 `mode` 与 `selectedIndex` 状态。
- **模式标签**：Missions 头部，标题与工作区筛选之间，加一个小 `Badge` 显示 `导航模式 / 输入模式`（`t("missions.mode.nav")` / `t("missions.mode.input")`）。

### 4.2 键位表

导航模式（裸键，仅 nav 生效——输入模式被表单守卫屏蔽）：

| 键 | 动作 |
|---|---|
| `1`–`9` | 跳到并聚焦第 N 个可见窗格（→ 输入模式） |
| `←/→/↑/↓` | 移动选中高亮（在窗格网格间移动 selectedIndex） |
| `Tab` / `Shift+Tab` | 循环移动选中（正/反向，环绕） |
| `Enter` | 聚焦当前选中窗格（→ 输入模式） |

两种模式都生效（修饰键组合，绕过守卫，`allowInInput` 隐含为 true）：

| 键 | 动作 |
|---|---|
| `$mod+]` | 聚焦下一个窗格（环绕，保持输入模式） |
| `$mod+[` | 聚焦上一个窗格（环绕，保持输入模式） |
| `$mod+ArrowRight` | 下一个窗格（别名） |
| `$mod+ArrowLeft` | 上一个窗格（别名） |
| `$mod+Escape` | 退回导航模式（blur 当前终端，重新显示遮罩） |

> 不绑定裸 `Esc`——避免劫持 Claude CLI 的中断键。

### 4.3 导航模式视觉（hint 叠层）

- 每个 `MissionCard` 终端区盖一层半透明遮罩（`bg-background/60` 或 `bg-black/40`，压暗内容，`pointer-events-none` 不挡拖拽？遮罩需要可点选切换——见下）。
- 遮罩正中：方形格子 + 大数字（该窗格可见顺序序号 1–9）。
- **选中**窗格（方向键/Tab 落点）：数字格子高亮加强（更亮背景 + `ring-2 ring-primary`）；其余普通态。
- 交互：
  - 数字 `1–9` → 直接跳转聚焦。
  - 方向键/Tab → 移动高亮。
  - `Enter` → 聚焦高亮窗格。
  - 鼠标点击遮罩/窗格 → 聚焦该窗格（进入输入模式）。
- **超过 9 个窗格**：第 10+ 个不显示数字角标（仍可用方向键/`$mod+[]` 到达）；用 `log`/注释说明此限制。
- 遮罩与角标进出场淡入淡出（`transition-opacity`）。

### 4.4 焦点管理（不依赖 dynamic ref 转发）

`TaskTerminal` 经 `next/dynamic` 加载，ref 不易转发。改用回调注册：

```ts
// TaskTerminal 新增 props（向后兼容，可选）
export interface TaskTerminalProps {
  // ...existing
  /** 终端就绪/销毁时回调，传出命令式控制句柄（销毁传 null） */
  onReady?: (controls: TerminalControls | null) => void;
}
export interface TerminalControls {
  focus: () => void;   // terminal.focus()
  blur: () => void;    // terminal.blur()
}
```

- `TaskTerminal` 在创建 terminal 后 `onReady({ focus, blur })`，cleanup 时 `onReady(null)`。
- `MissionCard` 新增 props：`index: number`、`mode: "nav"|"input"`、`isSelected: boolean`、`onRegisterControls(taskId, controls|null)`、`onRequestFocus(taskId)`（点击遮罩时）。把 `onReady` 转给上层。
- `MissionsClient` 维护 `Map<taskId, TerminalControls>`，并以 `visibleCards` 顺序构建 `orderedControls: TerminalControls[]`。
  - `focusPane(i)`：`orderedControls[i]?.focus()`；`setSelectedIndex(i)`；`setMode("input")`。
  - `exitToNav()`：`orderedControls[selectedIndex]?.blur()`；`setMode("nav")`。
  - `nextPane()/prevPane()`：环绕计算 i，`focusPane(i)`（保持 input）。
  - `moveSelection(dir)`：按网格列数 `gridCols` 计算上下左右目标 index（仅改高亮，不聚焦）。
- **鼠标点击进入 input**：在网格容器上监听 `focusin`——焦点进入某终端容器时，置 `mode="input"` 且 `selectedIndex` = 对应 index。确保鼠标点击窗格也正确切模式。

### 4.5 键盘 → action 接线

`MissionsClient` 内用 `useShortcut`（scope `"missions"`）注册 4.2 全部绑定。数字 1-9 用单个 handler 读 `event.key` 求 index。方向键、Tab 在 nav 模式 `preventDefault`（默认即 true）。`$mod+*` 组合在两种模式可用。

---

## 5. 全局快捷键（本版）

| 键 | 动作 | 说明 |
|---|---|---|
| `$mod+k` | 全局搜索 | 迁移 `top-bar.tsx` 现有 `useEffect` 监听 → 框架。搜索弹窗仍由 top-bar 持有，框架通过事件/回调或共享 store 触发。 |
| `$mod+p` | 命令面板 | 新建 cmdk 面板。命令项：跳转 Missions、新建任务/项目、切换语言、切主题、打开设置、打开帮助……可扩展。 |
| `$mod+/` 或 `?` | 帮助 / Cheatsheet | 打开快捷键帮助弹窗。 |

`$mod+k` 与 `$mod+p` 分离（风险最小，不动现有搜索）。

**top-bar.tsx 迁移**：删除其本地 `useEffect` keydown，改用框架。最简：top-bar 仍持 `showSearch` 状态，用 `useShortcut("$mod+k", () => setShowSearch(true), {...})` 替换原生监听。命令面板用独立 provider 持开关。

命令面板项路由「切换工作区/项目、新建任务」等——面板是这些操作的可扩展入口，不再单独造 chord。

---

## 6. i18n（集中由 foundation agent 添加，避免冲突）

在 `src/lib/i18n/zh.ts` 与 `src/lib/i18n/en.ts` 新增以下键（zh / en）：

```
shortcuts.help.title           "快捷键" / "Keyboard Shortcuts"
shortcuts.help.searchPlaceholder "搜索快捷键…" / "Search shortcuts…"
shortcuts.group.global         "全局" / "Global"
shortcuts.group.missions       "任务控制台" / "Mission Control"
shortcuts.search               "全局搜索" / "Global search"
shortcuts.commandPalette       "命令面板" / "Command palette"
shortcuts.openHelp             "快捷键帮助" / "Keyboard shortcuts help"
shortcuts.missions.jump        "跳到第 N 个窗格" / "Jump to pane N"
shortcuts.missions.nextPane    "下一个终端" / "Next terminal"
shortcuts.missions.prevPane    "上一个终端" / "Previous terminal"
shortcuts.missions.moveSel     "移动选中（方向键）" / "Move selection (arrows)"
shortcuts.missions.cyclePane   "循环切换（Tab）" / "Cycle panes (Tab)"
shortcuts.missions.focusSel    "聚焦选中窗格" / "Focus selected pane"
shortcuts.missions.exitToNav   "退回导航模式" / "Back to navigation"
missions.mode.nav              "导航模式" / "Navigation"
missions.mode.input            "输入模式" / "Input"
missions.hint.label            "选择窗格" / "Select a pane"
palette.title                  "命令面板" / "Command Palette"
palette.placeholder            "输入命令或搜索…" / "Type a command or search…"
palette.empty                  "无匹配命令" / "No commands found"
palette.group.navigation       "导航" / "Navigation"
palette.group.actions          "操作" / "Actions"
palette.group.preferences      "偏好" / "Preferences"
palette.gotoMissions           "前往任务控制台" / "Go to Mission Control"
palette.newProject             "新建项目" / "New project"
palette.importProject          "导入项目" / "Import project"
palette.toggleTheme            "切换主题" / "Toggle theme"
palette.toggleLocale           "切换语言" / "Toggle language"
palette.openSettings           "打开设置" / "Open settings"
palette.openHelp               "快捷键帮助" / "Keyboard shortcuts help"
```

> 类型由 `keyof typeof zh` 推导——两文件键必须完全一致。

---

## 7. 冲突与终端兼容策略（汇总）

1. capture 阶段单监听 → 抢在 xterm 前。命中 `preventDefault + stopPropagation`，xterm 收不到。
2. 表单守卫：裸键在 input/textarea/contenteditable（含 xterm textarea）下默认屏蔽 → 双模式天然成立。
3. 修饰键组合绕过守卫 → 输入模式下仍能 `$mod+[]` 切窗格、`$mod+Esc` 退出。
4. 不绑定裸 `Esc`，保护 Claude CLI 中断键。
5. 浏览器标签冲突：窗格直跳用「导航模式裸数字键」，不用 `$mod+数字`（被浏览器占用）。`$mod+p` 印刷、`$mod+/` 等用 `preventDefault` 拦下。

---

## 8. 测试

`*.test.ts(x)`（vitest，沿用项目现有测试栈）：

- **dispatcher**：绑定匹配、scope 过滤、优先级冲突、表单守卫（裸键被屏蔽 / 修饰键绕过）、preventDefault。
- **store**：register/unregister、id 唯一、归一化 keys。
- **missions 焦点逻辑**：抽成纯函数测试 `nextIndex(cur, len, dir)`、`moveSelection(index, cols, len, dir)`（环绕、边界）。
- **TerminalControls 注册**：Map 增删、orderedControls 顺序随 visibleCards。

覆盖率目标沿用项目标准。组件交互（实际 DOM keydown → 聚焦）可加少量 RTL 测试，但优先把索引/派发逻辑抽纯函数测。

---

## 9. 实现分解（agent 编排）

- **Agent A（foundation，先行）**：安装 `tinykeys`；建 `src/lib/shortcuts/*` 全部文件；挂载 `ShortcutProvider` 到 layout；集中添加 §6 全部 i18n 键（zh+en）；dispatcher + store 单测。**产出框架契约，B/C 依赖。**
- **Agent B（global surfaces）**：命令面板（cmdk）+ provider + `$mod+p`；帮助弹窗 + `$mod+/` / `?`；迁移 top-bar `$mod+k`。消费 A 的 hook 与 i18n。
- **Agent C（missions）**：`TaskTerminal` 加 `onReady`；`MissionCard` 加遮罩 hint + 控制转发；`MissionsClient` 加 mode/selectedIndex/焦点 Map/键盘接线/模式标签；纯函数 + 必要 RTL 测试。
- **Gate**：每阶段 `pnpm tsc --noEmit`（或项目 typecheck 脚本）+ `pnpm test:run` 相关用例。B、C 并行（文件不重叠，i18n 已由 A 统一）。
</content>
</invoke>
