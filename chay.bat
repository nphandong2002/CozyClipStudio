@echo off
chcp 65001 >nul
title CozyClip Studio
cd /d "%~dp0"

echo ============================================
echo   CozyClip Studio
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [X] Chua cai Node.js. Hay cai Node.js 20+ tai https://nodejs.org roi chay lai.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [*] Lan dau chay - dang cai dependencies, vui long doi...
  call npm install
  if errorlevel 1 (
    echo [X] Cai dependencies that bai. Kiem tra mang roi thu lai.
    echo.
    pause
    exit /b 1
  )
)

echo [*] Dang khoi dong app... (dong cua so Electron de dung)
echo.
call npm run dev

echo.
echo [*] App da dung.
pause
