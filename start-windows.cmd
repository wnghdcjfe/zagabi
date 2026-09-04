@echo off
chcp 65001 > NUL
cd /d "%~dp0"

where node > NUL 2> NUL
if errorlevel 1 (
  echo Node.js not found. Install Node.js 18+ from https://nodejs.org and run this file again.
  pause
  exit /b 1
)

node scripts\start.js
set EXITCODE=%errorlevel%
echo.
echo judge server stopped ^(exit code %EXITCODE%^)
pause
exit /b %EXITCODE%
