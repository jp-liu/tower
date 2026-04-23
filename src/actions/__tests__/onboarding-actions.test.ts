import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock db before any imports
vi.mock("@/lib/db", () => ({
  db: {
    systemConfig: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockLogInfo = vi.fn();
vi.mock("@/lib/logger", () => ({
  logger: {
    create: vi.fn(() => ({
      info: mockLogInfo,
      warn: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import {
  getOnboardingStatus,
  setOnboardingProgress,
  completeOnboarding,
  dispatchTaskCompletionEvent,
  type OnboardingStatus,
  type TaskCompletionPayload,
} from "@/actions/onboarding-actions";

const mockDb = db as {
  systemConfig: {
    findMany: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
};

describe("onboarding-actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getOnboardingStatus", () => {
    it("returns isFirstRun:true and lastStep:0 when no SystemConfig rows exist", async () => {
      mockDb.systemConfig.findMany.mockResolvedValue([]);

      const result = await getOnboardingStatus();

      expect(result).toEqual<OnboardingStatus>({
        isFirstRun: true,
        isCompleted: false,
        lastStep: 0,
        username: null,
      });
      expect(mockDb.systemConfig.findMany).toHaveBeenCalledWith({
        where: { key: { in: ["onboarding.completed", "onboarding.lastStep", "onboarding.username"] } },
      });
    });

    it("returns isFirstRun:false and isCompleted:true after onboarding.completed=true", async () => {
      mockDb.systemConfig.findMany.mockResolvedValue([
        { key: "onboarding.completed", value: "true" },
        { key: "onboarding.lastStep", value: "2" },
      ]);

      const result = await getOnboardingStatus();

      expect(result).toEqual<OnboardingStatus>({
        isFirstRun: false,
        isCompleted: true,
        lastStep: 2,
        username: null,
      });
    });

    it("returns isFirstRun:true and lastStep:1 when only lastStep=1 is stored", async () => {
      mockDb.systemConfig.findMany.mockResolvedValue([
        { key: "onboarding.lastStep", value: "1" },
      ]);

      const result = await getOnboardingStatus();

      expect(result).toEqual<OnboardingStatus>({
        isFirstRun: true,
        isCompleted: false,
        lastStep: 1,
        username: null,
      });
    });

    it("handles JSON parse errors gracefully and returns defaults", async () => {
      mockDb.systemConfig.findMany.mockResolvedValue([
        { key: "onboarding.completed", value: "not-valid-json{{{" },
        { key: "onboarding.lastStep", value: "not-a-number" },
      ]);

      const result = await getOnboardingStatus();

      expect(result.isCompleted).toBe(false);
      expect(result.isFirstRun).toBe(true);
      expect(result.lastStep).toBe(0);
    });
  });

  describe("setOnboardingProgress", () => {
    it("upserts onboarding.lastStep with the provided step number", async () => {
      mockDb.systemConfig.upsert.mockResolvedValue({});

      await setOnboardingProgress(1);

      expect(mockDb.systemConfig.upsert).toHaveBeenCalledWith({
        where: { key: "onboarding.lastStep" },
        create: { key: "onboarding.lastStep", value: "1" },
        update: { value: "1" },
      });
    });

    it("calls revalidatePath('/', 'layout') after upserting", async () => {
      mockDb.systemConfig.upsert.mockResolvedValue({});

      await setOnboardingProgress(1);

      expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    });
  });

  describe("completeOnboarding", () => {
    it("upserts both onboarding.completed=true and onboarding.lastStep=2", async () => {
      mockDb.systemConfig.upsert.mockResolvedValue({});

      await completeOnboarding();

      expect(mockDb.systemConfig.upsert).toHaveBeenCalledWith({
        where: { key: "onboarding.completed" },
        create: { key: "onboarding.completed", value: "true" },
        update: { value: "true" },
      });
      expect(mockDb.systemConfig.upsert).toHaveBeenCalledWith({
        where: { key: "onboarding.lastStep" },
        create: { key: "onboarding.lastStep", value: "2" },
        update: { value: "2" },
      });
      expect(mockDb.systemConfig.upsert).toHaveBeenCalledTimes(2);
    });

    it("also upserts onboarding.username if username argument provided", async () => {
      mockDb.systemConfig.upsert.mockResolvedValue({});

      await completeOnboarding("alice");

      expect(mockDb.systemConfig.upsert).toHaveBeenCalledWith({
        where: { key: "onboarding.username" },
        create: { key: "onboarding.username", value: '"alice"' },
        update: { value: '"alice"' },
      });
      expect(mockDb.systemConfig.upsert).toHaveBeenCalledTimes(3);
    });

    it("calls revalidatePath('/', 'layout') after completing", async () => {
      mockDb.systemConfig.upsert.mockResolvedValue({});

      await completeOnboarding();

      expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    });
  });

  describe("dispatchTaskCompletionEvent", () => {
    beforeEach(() => {
      // Reset the globalThis queue before each test
      (globalThis as Record<string, unknown>).__taskCompletionQueue = undefined;
    });

    it("logs the payload via logger without throwing", async () => {
      const payload: TaskCompletionPayload = {
        taskId: "task1",
        taskTitle: "Test Task",
        status: "COMPLETED",
        executionId: "exec1",
        workspaceId: "ws1",
      };

      await expect(dispatchTaskCompletionEvent(payload)).resolves.not.toThrow();
      expect(mockLogInfo).toHaveBeenCalledWith(
        "Task completion event dispatched",
        expect.objectContaining({ taskId: "task1", taskTitle: "Test Task", status: "COMPLETED" })
      );
    });

    it("pushes payload to globalThis.__taskCompletionQueue", async () => {
      const payload: TaskCompletionPayload = {
        taskId: "task1",
        taskTitle: "Test Task",
        status: "COMPLETED",
        executionId: "exec1",
        workspaceId: "ws1",
      };

      await dispatchTaskCompletionEvent(payload);

      const queue = (globalThis as Record<string, unknown>).__taskCompletionQueue as TaskCompletionPayload[];
      expect(queue).toBeDefined();
      expect(queue).toHaveLength(1);
      expect(queue[0]).toEqual(payload);
    });

    it("caps queue at 50 entries (splices oldest)", async () => {
      // Pre-fill with 50 entries
      const initialQueue: TaskCompletionPayload[] = Array.from({ length: 50 }, (_, i) => ({
        taskId: `task-old-${i}`,
        taskTitle: `Old Task ${i}`,
        status: "COMPLETED" as const,
        executionId: `exec-old-${i}`,
        workspaceId: "ws1",
      }));
      (globalThis as Record<string, unknown>).__taskCompletionQueue = initialQueue;

      const newPayload: TaskCompletionPayload = {
        taskId: "task-new",
        taskTitle: "New Task",
        status: "COMPLETED",
        executionId: "exec-new",
        workspaceId: "ws1",
      };

      await dispatchTaskCompletionEvent(newPayload);

      const queue = (globalThis as Record<string, unknown>).__taskCompletionQueue as TaskCompletionPayload[];
      expect(queue).toHaveLength(50);
      // Newest entry should be at the end
      expect(queue[queue.length - 1]).toEqual(newPayload);
      // Oldest entry should have been removed
      expect(queue[0].taskId).toBe("task-old-1");
    });

    it("swallows errors silently (best-effort)", async () => {
      // Simulate logger throwing an error
      mockLogInfo.mockImplementationOnce(() => {
        throw new Error("Logger failed");
      });

      const payload: TaskCompletionPayload = {
        taskId: "task2",
        taskTitle: "Failing Task",
        status: "FAILED",
        executionId: "exec2",
        workspaceId: "ws2",
      };

      await expect(dispatchTaskCompletionEvent(payload)).resolves.not.toThrow();
    });
  });
});
