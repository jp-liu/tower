@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo TOWER_ERROR=NODE_NOT_FOUND minimum=22.0.0 tested=22^|24 action="Install Node.js 22 LTS or newer and retry." 1>&2
  exit /b 1
)
for /f %%V in ('node -p "Number(process.versions.node.split('.')[0])"') do set "NODE_MAJOR=%%V"
if %NODE_MAJOR% LSS 22 (
  for /f %%V in ('node --version') do set "NODE_VERSION=%%V"
  echo TOWER_ERROR=UNSUPPORTED_NODE minimum=22.0.0 tested=22^|24 found=%NODE_VERSION% action="Install Node.js 22 LTS or newer and retry." 1>&2
  exit /b 1
)
if not "%NODE_MAJOR%"=="22" if not "%NODE_MAJOR%"=="24" echo TOWER_WARNING=UNTESTED_NODE minimum=22.0.0 tested=22^|24 found=%NODE_MAJOR% action="Continue best-effort or use Node.js 22/24 LTS for full support." 1>&2
node "%~dp0..\runtime\package\bin\tower.mjs" %*
