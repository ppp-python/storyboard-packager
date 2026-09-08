@echo off
setlocal
cd /d "%~dp0"

if not exist "dist\client\index.html" (
  echo [ERROR] dist\client\index.html was not found.
  echo Rebuild the project with: pnpm build
  pause
  exit /b 1
)

where powershell.exe >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Windows PowerShell was not found.
  pause
  exit /b 1
)

echo Starting the local storyboard packager...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\local-static-server.ps1" -Root "%~dp0dist\client"
set "TASK_EXIT_CODE=%ERRORLEVEL%"

if not "%TASK_EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] The local web server did not start. See the message above.
  pause
)
exit /b %TASK_EXIT_CODE%
