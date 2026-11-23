@echo off
rem ============================================================
rem  Clara Writer: installer
rem  Downloads the latest version from GitHub, puts it in
rem  %LOCALAPPDATA%\Programs\Clara Writer, creates the shortcuts
rem  and starts it. Nothing else needs to be downloaded by hand.
rem  Copyright (C) 2026 Francesco Bonomelli. GNU GPL v3.
rem ============================================================
title Clara Writer
set "CW_SELF=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "iex ((Get-Content -LiteralPath $env:CW_SELF -Raw -Encoding UTF8) -split '#[ ]POWERSHELL[ ]BELOW[ ]#', 2)[1]"
exit /b

# POWERSHELL BELOW #
$ErrorActionPreference = "Stop"
$repo = "digima-web/clara-writer"
$dest = Join-Path $env:LOCALAPPDATA "Programs\Clara Writer"

$it = (Get-UICulture).TwoLetterISOLanguageName -eq "it"
function T($en, $itText) { if ($it) { $itText } else { $en } }

Clear-Host
Write-Host ""
Write-Host "  ==============================================" -ForegroundColor Cyan
Write-Host "    CLARA WRITER" -ForegroundColor Cyan
Write-Host "    $(T 'Installing. Internet is needed.' 'Installazione in corso. Serve Internet.')" -ForegroundColor Cyan
Write-Host "  ==============================================" -ForegroundColor Cyan
Write-Host ""

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

    Write-Host "  $(T 'Looking for the latest version...' 'Cerco l''ultima versione...')"
    $rel = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" -Headers @{ "User-Agent" = "ClaraWriter" }
    $asset = $rel.assets | Where-Object { $_.name -eq "clara-writer.zip" } | Select-Object -First 1
    if (-not $asset) { throw "clara-writer.zip not found in release $($rel.tag_name)" }

    Write-Host "  $(T 'Downloading' 'Scarico') Clara Writer $($rel.tag_name)..."
    $zip = Join-Path $env:TEMP "clara-writer-setup.zip"
    $tmp = Join-Path $env:TEMP "clara-writer-setup"
    Invoke-WebRequest $asset.browser_download_url -OutFile $zip -UseBasicParsing
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
    Expand-Archive $zip -DestinationPath $tmp -Force

    Write-Host "  $(T 'Copying the program to' 'Copio il programma in') $dest"
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    # stop a running copy before replacing its files
    Get-CimInstance Win32_Process -Filter "Name='pythonw.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*server.py*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Copy-Item (Join-Path $tmp "*") $dest -Recurse -Force
    Remove-Item $zip, $tmp -Recurse -Force -ErrorAction SilentlyContinue

    Write-Host "  $(T 'Creating the shortcuts on the desktop and in the Start menu...' 'Creo le icone sul desktop e nel menu Start...')"
    $shell = New-Object -ComObject WScript.Shell
    $places = @([Environment]::GetFolderPath("Desktop"), [Environment]::GetFolderPath("Programs"))
    foreach ($place in $places) {
        $lnk = $shell.CreateShortcut((Join-Path $place "Clara Writer.lnk"))
        $lnk.TargetPath = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
        $lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$dest\launcher.ps1`""
        $lnk.WorkingDirectory = $dest
        $lnk.IconLocation = "$dest\web\clara-writer.ico,0"
        $lnk.WindowStyle = 7
        $lnk.Description = "Clara Writer"
        $lnk.Save()
    }

    Write-Host ""
    Write-Host "  $(T 'Done. Clara Writer is starting: the first time it prepares the computer.' 'Fatto. Clara Writer si avvia: la prima volta prepara il computer.')" -ForegroundColor Green
    Start-Sleep -Seconds 2
    Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$dest\launcher.ps1`"" -WorkingDirectory $dest
} catch {
    Write-Host ""
    Write-Host "  $(T 'The installation did not work:' 'L''installazione non e'' riuscita:')" -ForegroundColor Red
    Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  $(T 'Check the internet connection and try again.' 'Controlla la connessione a Internet e riprova.')"
    Write-Host ""
    Read-Host "  $(T 'Press Enter to close' 'Premi Invio per chiudere')"
}
