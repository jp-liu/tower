import { execute } from "./execute";
import { testEnvironment } from "./test";
import type { AdapterModule } from "../types";

export const claudeLocalAdapter: AdapterModule = {
  type: "claude_local",
  execute,
  testEnvironment,
};
