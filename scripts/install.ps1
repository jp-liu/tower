param(
  [string]$Version = "latest",
  [string]$DownloadBase = $env:TOWER_DOWNLOAD_BASE_URL,
  [string]$AssetDir,
  [string]$Prefix = $(if ($env:TOWER_INSTALL_DIR) { $env:TOWER_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "Tower\portable" }),
  [string]$BinDir = $(if ($env:TOWER_BIN_DIR) { $env:TOWER_BIN_DIR } else { Join-Path $env:LOCALAPPDATA "Tower\bin" }),
  [switch]$Verify,
  [switch]$Rollback,
  [switch]$Uninstall,
  [Alias("h", "help")][switch]$Help,
  [Alias("yes", "non-interactive")][switch]$ConfirmNonInteractive,
  [Alias("no-start")][switch]$NoStart
)
$ErrorActionPreference = "Stop"

if ($Help) {
  Write-Output "Usage: .\install.ps1 [-Version VERSION] [-DownloadBase URL] [-AssetDir DIR] [-Prefix DIR] [-BinDir DIR] [-Verify|-Rollback|-Uninstall] [-ConfirmNonInteractive] [-NoStart]"
  exit 0
}

if ($Rollback -or $Uninstall) {
  $currentFile = Join-Path $Prefix "current.txt"
  if (-not (Test-Path $currentFile)) { throw "Tower is not installed in $Prefix" }
  $current = (Get-Content $currentFile -Raw).Trim()
  $installer = Join-Path $Prefix "versions\$current\install.ps1"
  if (-not (Test-Path $installer)) { throw "Installed Tower payload is missing: $installer" }
  if ($Rollback) { & $installer -Prefix $Prefix -BinDir $BinDir -Rollback } else { & $installer -Prefix $Prefix -BinDir $BinDir -Uninstall }
  exit $LASTEXITCODE
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'TOWER_ERROR=NODE_NOT_FOUND minimum=22.0.0 tested=22|24 action="Install Node.js 22 LTS or newer and retry."'
}
$major = [int](& node -p "Number(process.versions.node.split('.')[0])")
if ($major -lt 22) {
  $found = & node --version
  throw "TOWER_ERROR=UNSUPPORTED_NODE minimum=22.0.0 tested=22|24 found=$found action=`"Install Node.js 22 LTS or newer and retry.`""
}
if ($major -notin @(22, 24)) {
  $found = & node --version
  Write-Warning "TOWER_WARNING=UNTESTED_NODE minimum=22.0.0 tested=22|24 found=$found action=`"Continue best-effort or use Node.js 22/24 LTS for full support.`""
}

if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -notmatch "AMD64") {
  throw "Tower portable releases currently support Windows x64 only."
}
$asset = "tower-portable-windows-x64.tar.gz"
$temp = Join-Path ([IO.Path]::GetTempPath()) "tower-install-$([guid]::NewGuid())"
New-Item -ItemType Directory $temp | Out-Null
try {
  if ($AssetDir) {
    Copy-Item (Join-Path $AssetDir $asset) (Join-Path $temp $asset)
    Copy-Item (Join-Path $AssetDir "SHA256SUMS") (Join-Path $temp "SHA256SUMS")
  } else {
    if (-not $DownloadBase) {
      $DownloadBase = if ($Version -eq "latest") { "https://github.com/tower-org/tower/releases/latest/download" } else { "https://github.com/tower-org/tower/releases/download/v$($Version.TrimStart('v'))" }
    }
    $downloadUri = [uri]$DownloadBase
    if ($downloadUri.Scheme -ne "https") { throw "Download base must use HTTPS: $DownloadBase" }
    Invoke-WebRequest "$DownloadBase/$asset" -OutFile (Join-Path $temp $asset)
    Invoke-WebRequest "$DownloadBase/SHA256SUMS" -OutFile (Join-Path $temp "SHA256SUMS")
  }
  $line = Get-Content (Join-Path $temp "SHA256SUMS") | Where-Object { $_ -match "\s\*?$([regex]::Escape($asset))$" } | Select-Object -First 1
  if (-not $line) { throw "No checksum found for $asset" }
  $expected = ($line -split "\s+")[0].ToLowerInvariant()
  $actual = (Get-FileHash (Join-Path $temp $asset) -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw "SHA-256 mismatch for $asset" }

  $entries = & tar -tzf (Join-Path $temp $asset)
  if ($LASTEXITCODE -ne 0) { throw "Unable to read portable tar archive." }
  foreach ($entry in $entries) {
    if ([IO.Path]::IsPathRooted($entry) -or $entry -match '(^|/)\.\.(/|$)') { throw "Unsafe archive path: $entry" }
  }
  & tar -xzf (Join-Path $temp $asset) -C $temp
  if ($LASTEXITCODE -ne 0) { throw "Unable to extract portable tar archive." }
  $root = Get-ChildItem $temp -Directory -Filter "tower-v*"
  if ($root.Count -ne 1) { throw "Archive must contain one Tower root directory." }
  $manifest = Get-Content (Join-Path $root.FullName "portable-manifest.json") -Raw | ConvertFrom-Json
  if ($Version -ne "latest" -and $manifest.version -ne $Version.TrimStart('v')) { throw "Requested $Version but archive contains $($manifest.version)" }
  if ($manifest.platform -ne "windows" -or $manifest.arch -ne "x64") { throw "Archive target $($manifest.platform)-$($manifest.arch) does not match this machine windows-x64" }
  if ($Verify) { & (Join-Path $root.FullName "install.ps1") -Verify -Prefix $Prefix -BinDir $BinDir -ConfirmNonInteractive }
  else { & (Join-Path $root.FullName "install.ps1") -Prefix $Prefix -BinDir $BinDir -ConfirmNonInteractive -NoStart }
  exit $LASTEXITCODE
} finally {
  Remove-Item -Recurse -Force $temp -ErrorAction SilentlyContinue
}
