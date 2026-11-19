@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Нужен Node.js. Скачай LTS-версию: https://nodejs.org  , установи и запусти START.bat снова.
  echo.
  pause
  exit /b
)
if not exist node_modules (
  echo Устанавливаю зависимости, это один раз...
  call npm install
)
start "" http://localhost:3000
node server.js
pause
