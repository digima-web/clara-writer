@echo off
rem ============================================================
rem  Clara Writer: avvia l'editor con Claude
rem  Doppio clic su questo file (o sul collegamento sul desktop)
rem ============================================================
cd /d "%~dp0"
title Clara Writer

rem 0. Prima volta: installa i programmi necessari
rem    (per rifare l'installazione basta cancellare il file installato.ok)
if not exist "%~dp0installato.ok" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installa.ps1"
  if not exist "%~dp0installato.ok" exit /b 1
)

rem 1. Spegne un eventuale server rimasto acceso, cosi' carica sempre la versione aggiornata
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='pythonw.exe'\" | Where-Object { $_.CommandLine -like '*server.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>nul

rem 2. Trova Python
set "PYW="
for /f "delims=" %%p in ('where pyw 2^>nul') do if not defined PYW set "PYW=%%p"
if not defined PYW if exist "%LOCALAPPDATA%\Programs\Python\Launcher\pyw.exe" set "PYW=%LOCALAPPDATA%\Programs\Python\Launcher\pyw.exe"
if not defined PYW if exist "%WINDIR%\pyw.exe" set "PYW=%WINDIR%\pyw.exe"
if not defined PYW for /d %%d in ("%LOCALAPPDATA%\Programs\Python\Python3*") do if exist "%%d\pythonw.exe" set "PYW=%%d\pythonw.exe"
if not defined PYW for /f "delims=" %%p in ('where pythonw 2^>nul') do if not defined PYW set "PYW=%%p"
if not defined PYW (
  echo.
  echo   Non trovo Python. Cancella il file installato.ok e avvia di nuovo Clara Writer.
  echo.
  pause
  exit /b 1
)

rem 3. Avvia il server locale senza finestre visibili
start "" "%PYW%" "%~dp0server.py"
timeout /t 2 /nobreak >nul

rem 4. Apre l'editor in una finestra dedicata di Edge, senza barre
start "" msedge --app=http://127.0.0.1:8765 --start-maximized ^
  --user-data-dir="%LOCALAPPDATA%\ClaraWriter\edge" ^
  --no-first-run --no-default-browser-check ^
  --autoplay-policy=no-user-gesture-required
