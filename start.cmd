@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js не найден. Поставь Node 20 LTS с https://nodejs.org
  exit /b 1
)
node server.js
