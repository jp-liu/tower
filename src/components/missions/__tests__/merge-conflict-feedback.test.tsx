import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import {
  buildMissionMergeConflictFeedback,
  submitMissionMergeConflictFeedback,
} from "../merge-conflict-feedback";
import { MissionMergeConflictFeedback } from "../mission-merge-conflict-feedback";

vi.mock("@/actions/config-actions", () => ({ setConfigValue: vi.fn() }));

const conflict = {
  taskId: "task-1",
  baseBranch: "main",
  conflictFiles: ["src/b.ts", "src/a.ts"],
};

describe("Missions merge conflict delivery", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("submits one structured terminal turn for duplicate conflict callbacks", async () => {
    const fetchTerminalInput = vi.fn<(
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => Promise<Response>>(async () => new Response(
      JSON.stringify({ ok: true, deduped: false }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    const submittedKeys = new Set<string>();

    const [first, duplicate] = await Promise.all([
      submitMissionMergeConflictFeedback({ conflict, submittedKeys, fetchTerminalInput }),
      submitMissionMergeConflictFeedback({ conflict, submittedKeys, fetchTerminalInput }),
    ]);

    expect(fetchTerminalInput).toHaveBeenCalledTimes(1);
    expect(first.deduped).toBe(false);
    expect(duplicate.deduped).toBe(true);
    const [, init] = fetchTerminalInput.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ submit: true, idempotencyKey: first.idempotencyKey });
    expect(body.text).toContain("Target base branch: main");
    expect(body.text).toContain("src/a.ts");
    expect(body.text).toContain("src/b.ts");
    expect(body.text).toContain("git merge main");
    expect(body.text).toContain("current worktree");
    expect(body.text).toContain("click Complete again");
  });

  it("releases the local key after send failure so a deliberate retry can submit", async () => {
    const fetchTerminalInput = vi.fn<(
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => Promise<Response>>(async () => new Response(
      JSON.stringify({ error: "No active session" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    ));
    const submittedKeys = new Set<string>();
    const draft = buildMissionMergeConflictFeedback(conflict);

    await expect(submitMissionMergeConflictFeedback({
      conflict,
      submittedKeys,
      fetchTerminalInput,
    })).rejects.toThrow("No active session");

    expect(submittedKeys.has(draft.idempotencyKey)).toBe(false);
  });

  it("shows failed delivery without hiding the copyable conflict instructions", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const message = buildMissionMergeConflictFeedback(conflict).message;

    render(
      <I18nProvider>
        <MissionMergeConflictFeedback
          feedback={{ status: "failed", message, error: "No active session" }}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("No active session");
    expect(screen.getByLabelText("可复制的冲突处理指令")).toHaveTextContent("git merge main");
    fireEvent.click(screen.getByRole("button", { name: "复制" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(message));
  });
});
