@echo off
chcp 65001 >nul 2>nul
title Xinlu Weight Loss Plan
color 0B

echo.
echo  ========================================
echo     Xinlu Weight Loss Plan - Starting
echo  ========================================
echo.

:: Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js not found!
    echo  Please install Node.js: https://nodejs.org/
    echo.
    timeout /t 3
    exit /b 1
)

echo  [OK] Node.js detected

:: Kill any existing process on port 3000
echo  [..] Checking port 3000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do (
    echo  [..] Killing old process PID: %%a
    taskkill /F /PID %%a >nul 2>nul
)
timeout /t 1 /nobreak >nul

echo  [..] Starting server...
echo  [..] Browser will open automatically
echo.

node proxy-server.js

:: Server exited (browser closed), auto-close
exit
