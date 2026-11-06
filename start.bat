@echo off
title MuMu Memory Monitor
cd /d "%~dp0"
echo ============================================
echo  MuMu Memory Monitor
echo  Browser will open automatically.
echo  Close this window to stop monitoring.
echo ============================================
runtime\node.exe server.js
echo.
echo Monitor stopped.
pause
