@echo off
rem ============================================================
rem  Clara Writer: starts the editor
rem  Double-click this file (or its shortcut on the desktop)
rem  Copyright (C) 2026 Francesco Bonomelli. GNU GPL v3.
rem ============================================================
cd /d "%~dp0"
title Clara Writer

rem 0. First time: install the programs Clara Writer needs
rem    (to run the setup again, delete the file installed.ok)
if not exist "%~dp0installed.ok" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
  if not exist "%~dp0installed.ok" exit /b 1
)

rem 1. Stop a server still running, so the updated version is always loaded
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='pythonw.exe'\" | Where-Object { $_.CommandLine -like '*server.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>nul

rem 2. Find Python
set "PYW="
for /f "delims=" %%p in ('where pyw 2^>nul') do if not defined PYW set "PYW=%%p"
if not defined PYW if exist "%LOCALAPPDATA%\Programs\Python\Launcher\pyw.exe" set "PYW=%LOCALAPPDATA%\Programs\Python\Launcher\pyw.exe"
if not defined PYW if exist "%WINDIR%\pyw.exe" set "PYW=%WINDIR%\pyw.exe"
if not defined PYW for /d %%d in ("%LOCALAPPDATA%\Programs\Python\Python3*") do if exist "%%d\pythonw.exe" set "PYW=%%d\pythonw.exe"
if not defined PYW for /f "delims=" %%p in ('where pythonw 2^>nul') do if not defined PYW set "PYW=%%p"
if not defined PYW (
  echo.
  echo   Python not found. Delete the file installed.ok and start Clara Writer again.
  echo   Python non trovato. Cancella il file installed.ok e avvia di nuovo Clara Writer.
  echo.
  pause
  exit /b 1
)

rem 3. Start the local server, with no visible window
start "" "%PYW%" "%~dp0server.py"
timeout /t 2 /nobreak >nul

rem 4. Open the editor in its own Edge window, with no browser bars
start "" msedge --app=http://127.0.0.1:8765 --start-maximized ^
  --user-data-dir="%LOCALAPPDATA%\ClaraWriter\edge" ^
  --no-first-run --no-default-browser-check ^
  --autoplay-policy=no-user-gesture-required
