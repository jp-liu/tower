import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantProvider, useAssistant } from "../assistant-provider";
import { I18nProvider } from "@/lib/i18n";

const fetchMock = vi.fn();

vi.mock("@/actions/config-actions", () => ({ getConfigValue: async () => "sidebar" }));
vi.mock("@/actions/workspace-actions", () => ({ getWorkspacesWithProjects: async () => [] }));
vi.mock("@/lib/shortcuts", () => ({ useActionShortcut: () => undefined }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn() } }));

function Probe() {
  const assistant = useAssistant();
  return (
    <>
      <output data-testid="binding">{JSON.stringify(assistant.binding)}</output>
      <button onClick={assistant.createNewSession}>new</button>
      <button onClick={() => assistant.switchSession("as_22222222-2222-4222-8222-222222222222")}>switch</button>
      <button onClick={() => assistant.sendChatMessage("hello")}>send</button>
      <button onClick={assistant.clearConversation}>clear</button>
    </>
  );
}

describe("AssistantProvider session scope", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/internal/assistant/sessions?sessionId=") && init?.method === "POST") {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/api/internal/assistant/sessions") {
        return new Response(JSON.stringify({ sessions: [{
          id: "as_11111111-1111-4111-8111-111111111111",
          title: "Scoped",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          lastMessageAt: "2026-01-01T00:00:00.000Z",
          workspaceId: "w1",
          workspaceName: "Workspace",
          projectId: "p1",
          projectName: "Project",
          versionId: "v1",
          versionName: "Version",
        }, {
          id: "as_22222222-2222-4222-8222-222222222222",
          title: "Other scope",
          createdAt: "2026-01-02T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
          lastMessageAt: "2026-01-02T00:00:00.000Z",
          workspaceId: "w2",
          workspaceName: "Other workspace",
          projectId: "p2",
          projectName: "Other project",
          versionId: "v2",
          versionName: "Other version",
        }] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.startsWith("/api/internal/assistant/sessions?sessionId=")) {
        const other = url.includes("as_22222222-2222-4222-8222-222222222222");
        return new Response(JSON.stringify({
          sessionId: other
            ? "as_22222222-2222-4222-8222-222222222222"
            : "as_11111111-1111-4111-8111-111111111111",
          session: {
            workspaceId: other ? "w2" : "w1", workspaceName: other ? "Other workspace" : "Workspace",
            projectId: other ? "p2" : "p1", projectName: other ? "Other project" : "Project",
            versionId: other ? "v2" : "v1", versionName: other ? "Other version" : "Version",
          },
          messages: [],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url === "/api/internal/assistant/chat" && init?.method === "POST") {
        return new Response([
          'data: {"type":"session","sessionId":"as_22222222-2222-4222-8222-222222222222"}',
          'data: {"type":"done","sessionId":"as_22222222-2222-4222-8222-222222222222"}',
          "",
        ].join("\n\n"), { status: 200, headers: { "Content-Type": "text/event-stream" } });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("restores a selected session binding but sends a new session with an empty scope immediately", async () => {
    const user = userEvent.setup();
    render(<I18nProvider><AssistantProvider><Probe /></AssistantProvider></I18nProvider>);

    await waitFor(() => expect(screen.getByTestId("binding")).toHaveTextContent('"versionId":"v1"'));
    await user.click(screen.getByRole("button", { name: "switch" }));
    await waitFor(() => expect(screen.getByTestId("binding")).toHaveTextContent('"versionId":"v2"'));
    await user.click(screen.getByRole("button", { name: "new" }));
    expect(screen.getByTestId("binding")).toHaveTextContent("{}");
    await user.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() => {
      const chatCall = fetchMock.mock.calls.find(([url, init]) =>
        url === "/api/internal/assistant/chat" && init?.method === "POST");
      expect(chatCall).toBeDefined();
      const body = JSON.parse(String(chatCall![1].body));
      expect(body).toEqual(expect.objectContaining({ message: "hello" }));
      expect(body).not.toHaveProperty("workspaceId");
      expect(body).not.toHaveProperty("projectId");
      expect(body).not.toHaveProperty("versionId");
    });
  });

  it("clears the active conversation without clearing its restored scope", async () => {
    const user = userEvent.setup();
    render(<I18nProvider><AssistantProvider><Probe /></AssistantProvider></I18nProvider>);
    await waitFor(() => expect(screen.getByTestId("binding")).toHaveTextContent('"projectId":"p1"'));

    await user.click(screen.getByRole("button", { name: "clear" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/internal/assistant/sessions?sessionId="),
      expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "clear" }) }),
    ));
    expect(screen.getByTestId("binding")).toHaveTextContent('"projectId":"p1"');
  });
});
