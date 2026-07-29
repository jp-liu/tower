import { describe, expect, it } from "vitest";

// The CLI helpers are runtime ESM shared by the packaged JavaScript entrypoint.
import {
  serviceBackend,
  WINDOWS_SERVICE_TASK,
  windowsScheduledTaskCommand,
  windowsServiceScript,
} from "../../../bin/service.mjs";

describe("tower service backends", () => {
  it("selects LaunchAgent on macOS and Task Scheduler on Windows", () => {
    expect(serviceBackend("darwin")).toBe("launchagent");
    expect(serviceBackend("win32")).toBe("task-scheduler");
    expect(serviceBackend("linux")).toBe("unsupported");
    expect(WINDOWS_SERVICE_TASK).toBe("Tower Workbench");
  });

  it("builds a restartable Windows service wrapper with loopback-only Tower", () => {
    const script = windowsServiceScript({
      node: "C:\\Program Files\\nodejs\\node.exe",
      cli: "C:\\Tower App\\bin\\tower.mjs",
      cwd: "C:\\Tower App",
      data: "C:\\Users\\alice\\.tower",
      port: 3000,
      stdout: "C:\\Users\\alice\\.tower\\logs\\service.stdout.log",
      stderr: "C:\\Users\\alice\\.tower\\logs\\service.stderr.log",
    });

    expect(script).toContain('set "TOWER_DATA_DIR=C:\\Users\\alice\\.tower"');
    expect(script).toContain('set "TOWER_NO_OPEN=1"');
    expect(script).toContain('cd /d "C:\\Tower App"');
    expect(script).toContain(
      '"C:\\Program Files\\nodejs\\node.exe" "C:\\Tower App\\bin\\tower.mjs" start --port 3000 --host 127.0.0.1 --no-open',
    );
    expect(script).toContain("timeout /t 10 /nobreak >nul");
    expect(script).toContain("goto restart");
  });

  it("quotes the scheduled task action path", () => {
    expect(windowsScheduledTaskCommand("C:\\Tower Data\\service\\tower-service.cmd"))
      .toBe('cmd.exe /d /c ""C:\\Tower Data\\service\\tower-service.cmd""');
  });
});
