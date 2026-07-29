export const WINDOWS_SERVICE_TASK = "Tower Workbench";

export function serviceBackend(platform) {
  if (platform === "darwin") return "launchagent";
  if (platform === "win32") return "task-scheduler";
  return "unsupported";
}

function batchValue(value) {
  return String(value)
    .replaceAll("%", "%%")
    .replaceAll("\r", "")
    .replaceAll("\n", "");
}

function batchPath(value) {
  return batchValue(value).replaceAll('"', '""');
}

export function windowsServiceScript(input) {
  const node = batchPath(input.node);
  const cli = batchPath(input.cli);
  const cwd = batchPath(input.cwd);
  const data = batchValue(input.data);
  const stdout = batchPath(input.stdout);
  const stderr = batchPath(input.stderr);
  const port = String(input.port);

  return [
    "@echo off",
    "setlocal",
    `set "TOWER_DATA_DIR=${data}"`,
    'set "TOWER_NO_OPEN=1"',
    `cd /d "${cwd}"`,
    ":restart",
    `"${node}" "${cli}" start --port ${port} --host 127.0.0.1 --no-open 1>>"${stdout}" 2>>"${stderr}"`,
    "timeout /t 10 /nobreak >nul",
    "goto restart",
    "",
  ].join("\r\n");
}

export function windowsScheduledTaskCommand(scriptPath) {
  return `cmd.exe /d /c ""${batchPath(scriptPath)}""`;
}
