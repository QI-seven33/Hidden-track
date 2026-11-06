@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (echo Please install Node.js 24 first. & pause & exit /b 1)
if not exist node_modules (call npm ci || exit /b 1)
if not exist dist\server.mjs (call npm run build || exit /b 1)
call npm start
