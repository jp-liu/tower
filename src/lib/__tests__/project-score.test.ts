import { describe, expect, it } from "vitest";
import { scoreProject } from "../project-score";

describe("scoreProject", () => {
  it("matches a product shorthand across repository role suffixes", () => {
    expect(scoreProject({
      name: "enrollment-class-division-static",
      alias: "南京招生报名分班系统前端，南招分班前端，分班系统前端，分班前端",
      groupName: "南京分班",
    }, "南招分班系统")).toBeGreaterThanOrEqual(0.3);
  });

  it("does not turn an unrelated project into a fuzzy product match", () => {
    expect(scoreProject({
      name: "admissions-portal",
      alias: "南京招生报名门户前端",
      groupName: "南京招生报名",
    }, "南招分班系统")).toBe(0);
  });
});
