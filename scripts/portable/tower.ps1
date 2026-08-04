$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'TOWER_ERROR=NODE_NOT_FOUND minimum=22.0.0 tested=22|24 action="Install Node.js 22 LTS or newer and retry."'
}
$major = [int](& node -p "Number(process.versions.node.split('.')[0])")
if ($major -lt 22) {
  $version = & node --version
  throw "TOWER_ERROR=UNSUPPORTED_NODE minimum=22.0.0 tested=22|24 found=$version action=`"Install Node.js 22 LTS or newer and retry.`""
}
if ($major -notin @(22, 24)) {
  $version = & node --version
  Write-Warning "TOWER_WARNING=UNTESTED_NODE minimum=22.0.0 tested=22|24 found=$version action=`"Continue best-effort or use Node.js 22/24 LTS for full support.`""
}

& node (Join-Path $Root "runtime\package\bin\tower.mjs") @args
exit $LASTEXITCODE
