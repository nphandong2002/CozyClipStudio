@echo off
setlocal

rem Chay tu ban sao trong %TEMP% de "git pull" co the cap nhat chinh file nay
rem ma khong lam hong script dang chay. LUU Y: khong dat dau ngoac ( ) trong echo ben trong khoi if.
if /i not "%~1"=="--ban-sao" (
  copy /y "%~f0" "%TEMP%\cozyclip-chay.bat" >nul 2>nul && (
    call "%TEMP%\cozyclip-chay.bat" --ban-sao "%~dp0."
    exit /b
  )
)

set "APPDIR=%~dp0."
if /i "%~1"=="--ban-sao" set "APPDIR=%~2"

chcp 65001 >nul
title CozyClip Studio
cd /d "%APPDIR%"
if errorlevel 1 goto :loi_thu_muc

echo ============================================
echo   CozyClip Studio
echo ============================================
echo.

rem Khong bao gio hoi mat khau / khong treo khi pull
set GIT_TERMINAL_PROMPT=0
where git >nul 2>nul
if errorlevel 1 (
  echo [i] Khong tim thay git - bo qua cap nhat code.
) else (
  if exist ".git" (
    echo [*] Dang cap nhat code moi nhat...
    git -c credential.helper= -c core.askPass= pull --no-edit
    if errorlevel 1 (
      echo [!] Khong cap nhat duoc - bo qua, dung code hien co.
    )
  ) else (
    echo [i] Thu muc nay khong phai repo git - bo qua cap nhat.
  )
)
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

echo [*] Dang khoi dong app... - dong cua so Electron de dung
echo.
call npm run dev
if errorlevel 1 goto :loi_app
rem Dong Electron binh thuong thi tu dong cua so nay luon
exit /b 0

:loi_app
echo.
echo [X] App dung do loi - xem thong bao phia tren.
echo.
pause
exit /b 1

:loi_thu_muc
echo [X] Khong vao duoc thu muc app:
echo     %APPDIR%
echo.
pause
exit /b 1
