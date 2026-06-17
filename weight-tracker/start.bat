@echo off
chcp 65001 >nul 2>nul
title Xinlu Weight Loss Plan
color 0B

:: 切换到脚本所在目录
cd /d "%~dp0"

echo.
echo  ==========================================
echo      ~(‾▿‾)~  昕露的减重计划  ~(‾▿‾)~
echo           正在启动，请稍候...
echo  ==========================================
echo.

:: 检查 Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo  [X] 未检测到 Node.js 环境！
    echo  请先安装 Node.js: https://nodejs.org/
    echo.
    timeout /t 3
    exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo  [OK] Node.js 已就绪 (%NODE_VER%)

:: 检查并释放端口 3000
echo  [...] 检查端口 3000...
set FOUND_PID=
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do (
    set FOUND_PID=%%a
)
if defined FOUND_PID (
    echo  [...] 正在释放端口 (PID: %FOUND_PID%^)...
    taskkill /F /PID %FOUND_PID% >nul 2>nul
    timeout /t 1 /nobreak >nul
    echo  [OK] 端口已释放
) else (
    echo  [OK] 端口 3000 空闲
)

echo.
echo  (ง •̀_•́)ง  正在启动服务器...
echo  浏览器将自动打开，请勿关闭此窗口
echo  ------------------------------------------
echo.

node proxy-server.js

:: 服务器退出后自动关闭
exit
