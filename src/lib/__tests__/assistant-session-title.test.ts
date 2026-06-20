import { describe, it, expect } from "vitest";
import {
  cleanPrompt,
  deriveSessionTitle,
  type DiskSessionInfo,
} from "@/lib/assistant-session-title";

const base: DiskSessionInfo = { sessionId: "s", lastModified: 1 };

describe("cleanPrompt", () => {
  it("strips the injected identity context prefix", () => {
    expect(cleanPrompt("[Context: The user's name is 刘俊平.]  /tower 查看今日工作总结")).toBe(
      "查看今日工作总结"
    );
  });

  it("strips a bare /tower skill prefix", () => {
    expect(cleanPrompt("/tower 创建一个任务")).toBe("创建一个任务");
  });

  it("unwraps <command-args> skill XML", () => {
    expect(
      cleanPrompt(
        "<command-message>tower</command-message>\n<command-name>/tower</command-name>\n<command-args>在 tower 里创建任务</command-args>"
      )
    ).toBe("在 tower 里创建任务");
  });

  it("drops the appended attachment block", () => {
    expect(
      cleanPrompt("/tower 看下这个文件\n---\nThe user has attached the following file(s):\n/x.png")
    ).toBe("看下这个文件");
  });
});

describe("deriveSessionTitle", () => {
  it("prefers a user-set custom title", () => {
    expect(deriveSessionTitle({ ...base, customTitle: "我的会话", firstPrompt: "/tower hi" })).toBe(
      "我的会话"
    );
  });

  it("falls back to the cleaned first prompt", () => {
    expect(
      deriveSessionTitle({ ...base, firstPrompt: "[Context: x] /tower 帮我建项目" })
    ).toBe("帮我建项目");
  });

  it("falls back to the summary when the first prompt is only scaffolding", () => {
    // firstPrompt cleans down to empty ("/tower" with nothing after) → use summary.
    expect(
      deriveSessionTitle({ ...base, firstPrompt: "/tower", summary: "/tower 看下这个缺陷的日志" })
    ).toBe("看下这个缺陷的日志");
  });

  it("truncates to 30 characters", () => {
    const long = "一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十";
    expect(deriveSessionTitle({ ...base, customTitle: long }).length).toBe(30);
  });

  it("returns the fallback when nothing usable exists", () => {
    expect(deriveSessionTitle({ ...base })).toBe("New Session");
  });
});
