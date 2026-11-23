@echo off
rem Clara Writer: starts the editor (all the work is done by launcher.ps1)
rem Copyright (C) 2026 Francesco Bonomelli. GNU GPL v3.
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0launcher.ps1"
exit /b
