@echo off
setlocal
set "TOWER_POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if defined PROCESSOR_ARCHITEW6432 set "TOWER_POWERSHELL=%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%TOWER_POWERSHELL%" (
  echo TOWER_ERROR=POWERSHELL_NOT_FOUND action="Run install.ps1 with PowerShell 5.1 or newer." 1>&2
  exit /b 1
)
"%TOWER_POWERSHELL%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
exit /b %ERRORLEVEL%
