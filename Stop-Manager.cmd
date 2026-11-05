@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Stop-Manager.ps1" %*
if errorlevel 1 (
  echo Stop failed. No unrelated process was stopped.
  pause
  exit /b 1
)
