param(
  [string]$InstallDir = $(if ($env:TOWER_INSTALL_DIR) { $env:TOWER_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "Tower\portable" }),
  [string]$BinDir = $(if ($env:TOWER_BIN_DIR) { $env:TOWER_BIN_DIR } else { Join-Path $env:LOCALAPPDATA "Tower\bin" }),
  [Alias("prefix")][string]$Prefix,
  [Alias("yes", "non-interactive")][switch]$ConfirmNonInteractive,
  [Alias("no-start")][switch]$NoStart,
  [Alias("verify")][switch]$Verify,
  [Alias("h", "help")][switch]$Help,
  [switch]$Rollback,
  [switch]$Uninstall
)
$ErrorActionPreference = "Stop"
$SourceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($Prefix) { $InstallDir = $Prefix }

if ($Help) {
  Write-Output "Usage: .\install.ps1 [-ConfirmNonInteractive] [-Prefix DIR] [-BinDir DIR] [-Verify|-Rollback|-Uninstall] [-NoStart]"
  exit 0
}

$InstallDir = [IO.Path]::GetFullPath($InstallDir)
$installRoot = [IO.Path]::GetPathRoot($InstallDir)
$homeRoot = [IO.Path]::GetFullPath($HOME)
if ([StringComparer]::OrdinalIgnoreCase.Equals($InstallDir, $installRoot) -or
    [StringComparer]::OrdinalIgnoreCase.Equals($InstallDir, $homeRoot)) {
  throw "Unsafe install directory: $InstallDir"
}

if ($Verify) {
  & (Join-Path $SourceRoot "bin\tower.ps1") --version
  $verifyManifest = Get-Content (Join-Path $SourceRoot "portable-manifest.json") -Raw | ConvertFrom-Json
  if ($verifyManifest.node.minimum -ne "22.0.0") { throw "Portable manifest has an unsupported Node contract." }
  Write-Host "Portable Tower payload verified."
  exit 0
}

if ($Uninstall) {
  if (-not (Test-Path (Join-Path $InstallDir ".tower-portable-install"))) { throw "Refusing to remove unrecognized install directory: $InstallDir" }
  foreach ($name in @("tower.cmd", "tower.ps1")) {
    $candidate = Join-Path $BinDir $name
    if (Test-Path $candidate) { Remove-Item -Force $candidate }
  }
  if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
  Write-Host "Tower application files removed. User data remains in $(if ($env:TOWER_DATA_DIR) { $env:TOWER_DATA_DIR } else { Join-Path $HOME '.tower' })."
  exit 0
}

$currentFile = Join-Path $InstallDir "current.txt"
$previousFile = Join-Path $InstallDir "previous.txt"
if ($Rollback) {
  if (-not (Test-Path $previousFile)) { throw "No previous Tower version is available." }
  $current = (Get-Content $currentFile -Raw).Trim()
  $previous = (Get-Content $previousFile -Raw).Trim()
  Set-Content -NoNewline $currentFile $previous
  Set-Content -NoNewline $previousFile $current
  Write-Host "Rolled back Tower to $previous"
  exit 0
}

& (Join-Path $SourceRoot "bin\tower.ps1") --version | Out-Null
$manifest = Get-Content (Join-Path $SourceRoot "portable-manifest.json") -Raw | ConvertFrom-Json
$releaseName = "$($manifest.version)-$($manifest.platform)-$($manifest.arch)"
$versionsDir = Join-Path $InstallDir "versions"
$target = Join-Path $versionsDir $releaseName
$staging = Join-Path $InstallDir ".staging-$($manifest.version)-$PID"

New-Item -ItemType Directory -Force $versionsDir, $BinDir | Out-Null
Set-Content -NoNewline (Join-Path $InstallDir ".tower-portable-install") "tower-portable"
if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
New-Item -ItemType Directory $staging | Out-Null
Copy-Item (Join-Path $SourceRoot "*") $staging -Recurse -Force

$oldCurrent = if (Test-Path $currentFile) { (Get-Content $currentFile -Raw).Trim() } else { "" }
if (Test-Path $target) { Remove-Item -Recurse -Force $target }
Move-Item $staging $target
if ($oldCurrent -and $oldCurrent -ne $releaseName) { Set-Content -NoNewline $previousFile $oldCurrent }
Set-Content -NoNewline $currentFile $releaseName

$cmd = @"
@echo off
setlocal
set /p TOWER_RELEASE=<"$currentFile"
call "$InstallDir\versions\%TOWER_RELEASE%\bin\tower.cmd" %*
"@
Set-Content (Join-Path $BinDir "tower.cmd") $cmd -Encoding Ascii
$ps = @"
`$release = (Get-Content '$($currentFile.Replace("'", "''"))' -Raw).Trim()
`$target = Join-Path '$($InstallDir.Replace("'", "''"))\versions' `$release
& (Join-Path `$target 'bin\tower.ps1') @args
exit `$LASTEXITCODE
"@
Set-Content (Join-Path $BinDir "tower.ps1") $ps -Encoding UTF8

Write-Host "Tower $($manifest.version) installed in $target"
Write-Host "Run: $BinDir\tower.cmd"
Write-Host "Rollback: & '$target\install.ps1' -Rollback"
Write-Host "Uninstall: & '$target\install.ps1' -Uninstall"
