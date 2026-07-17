import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import type { HarnessMessageView } from "@/actions/harness-actions";

// Mock server actions — the client calls these in effects/handlers.
vi.mock("@/actions/harness-actions", () => ({
  getHarnessMessages: vi.fn().mockResolvedValue([]),
  replyHarnessAsk: vi.fn(),
  ignoreHarnessAsk: vi.fn(),
  dismissHarnessMessage: vi.fn(),
}));

import { HarnessClient } from "@/app/harness/harness-client";

afterEach(() => cleanup());

const openAsk: HarnessMessageView = {
  id: "h1",
  taskId: "ctask123456789012345",
  taskTitle: "登录页重构",
  workspaceName: "个人空间",
  projectName: "Tower",
  kind: "ask",
  content: "用方案 A 还是方案 B?",
  state: "OPEN",
  replyText: null,
  repliedAt: null,
  createdAt: new Date("2026-07-02T02:00:00Z").toISOString(),
};

const answered: HarnessMessageView = {
  ...openAsk,
  id: "h2",
  state: "ANSWERED",
  content: "要不要删旧表?",
  replyText: "先别删",
  repliedAt: new Date("2026-07-02T02:05:00Z").toISOString(),
};

function renderClient(initial: HarnessMessageView[]) {
  return render(
    <I18nProvider>
      <HarnessClient initial={initial} />
    </I18nProvider>
  );
}

describe("HarnessClient", () => {
  it("渲染页头、三个过滤 chips", () => {
    renderClient([]);
    expect(screen.getByText("通知中心")).toBeInTheDocument();
    expect(screen.getByText("待回复")).toBeInTheDocument(); // chip
    expect(screen.getByText("已回复")).toBeInTheDocument();
    expect(screen.getByText("全部")).toBeInTheDocument();
  });

  it("空列表显示空状态", () => {
    renderClient([]);
    expect(screen.getByText("暂无消息")).toBeInTheDocument();
  });

  it("OPEN ask 行：工作区/项目/任务名、内容、待回复徽标、查看详情/处理按钮", () => {
    renderClient([openAsk]);
    expect(screen.getByText("个人空间")).toBeInTheDocument();
    expect(screen.getByText("Tower")).toBeInTheDocument();
    expect(screen.getByText("登录页重构")).toBeInTheDocument();
    expect(screen.getByText("用方案 A 还是方案 B?")).toBeInTheDocument();
    // 待回复徽标（badge）—— chip 也叫「待回复」，故至少 2 处
    expect(screen.getAllByText("待回复").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("查看详情")).toBeInTheDocument();
    expect(screen.getByText("处理")).toBeInTheDocument();
    // 回复框在详情弹窗内，表格行不含
    expect(screen.queryByPlaceholderText(/输入回复/)).not.toBeInTheDocument();
  });

  it("已回复行：展示回复内容，处理按钮隐藏、无回复框", () => {
    renderClient([answered]);
    expect(screen.getByText("先别删")).toBeInTheDocument();
    expect(screen.queryByText("处理")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/输入回复/)).not.toBeInTheDocument();
  });
});
