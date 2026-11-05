@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Manager.ps1" %*
if errorlevel 1 (
  echo Start failed. Read the message above and runtime\logs\manager.log.
  pause
  exit /b 1
)
