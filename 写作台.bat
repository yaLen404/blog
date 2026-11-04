@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动写作台…
node write.mjs
if errorlevel 1 (
  echo.
  echo 启动失败，请确认已安装 Node.js。
  pause
)
