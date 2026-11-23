# ============================================================
#  Clara Writer: launcher
#  1. the first time, installs the programs it needs (install.ps1)
#  2. checks GitHub for a newer version and updates itself
#  3. starts the local server and opens the editor window
#  Started by the desktop shortcut and by "Clara Writer.bat".
#  Copyright (C) 2026 Francesco Bonomelli. GNU GPL v3.
# ============================================================

$ErrorActionPreference = "Continue"
$app = $PSScriptRoot
$logFile = Join-Path $app "clara-writer.log"
$repo = "digima-web/clara-writer"

function Log($text) { Add-Content $logFile "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  launcher: $text" -ErrorAction SilentlyContinue }

# ---- settings (config.json is optional)
$port = 8765
$autoUpdate = $true
$cfgFile = Join-Path $app "config.json"
if (Test-Path $cfgFile) {
    try {
        $cfg = Get-Content $cfgFile -Raw | ConvertFrom-Json
        if ($cfg.port) { $port = [int]$cfg.port }
        if ($cfg.auto_update -eq $false) { $autoUpdate = $false }
    } catch { Log "config.json is not valid: $_" }
}
# a developer copy (with a DEV file or a .git folder) never updates itself
if ((Test-Path (Join-Path $app "DEV")) -or (Test-Path (Join-Path $app ".git"))) { $autoUpdate = $false }

# ---- 1. first time: install what is needed (visible window)
$marker = Join-Path $app "installed.ok"
if (-not (Test-Path $marker)) {
    Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$app\install.ps1`"" -Wait
    if (-not (Test-Path $marker)) { Log "setup not completed"; exit 1 }
}

# ---- 2. update from GitHub Releases (quietly; any problem just skips it)
if ($autoUpdate) {
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $local = "0.0.0"
        $vf = Join-Path $app "VERSION"
        if (Test-Path $vf) { $local = (Get-Content $vf -Raw).Trim() }
        $rel = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" -Headers @{ "User-Agent" = "ClaraWriter" } -TimeoutSec 6
        $remote = $rel.tag_name.TrimStart("v")
        if ([version]$remote -gt [version]$local) {
            $asset = $rel.assets | Where-Object { $_.name -eq "clara-writer.zip" } | Select-Object -First 1
            if ($asset) {
                Log "updating $local -> $remote"
                $zip = Join-Path $env:TEMP "clara-writer-$remote.zip"
                $tmp = Join-Path $env:TEMP "clara-writer-$remote"
                Invoke-WebRequest $asset.browser_download_url -OutFile $zip -UseBasicParsing -TimeoutSec 120
                if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
                Expand-Archive $zip -DestinationPath $tmp -Force
                if (Test-Path (Join-Path $tmp "server.py")) {
                    # the zip never contains personal files (config.json, installed.ok, logs)
                    Copy-Item (Join-Path $tmp "*") $app -Recurse -Force
                    Log "updated to $remote"
                } else { Log "update package not valid" }
                Remove-Item $zip, $tmp -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    } catch { Log "update check skipped: $($_.Exception.Message)" }
}

# ---- 3. stop a server still running, so the current version is loaded
Get-CimInstance Win32_Process -Filter "Name='pythonw.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*server.py*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# ---- 4. find Python (pythonw: no console window)
$py = $null
foreach ($p in @("$env:LOCALAPPDATA\Programs\Python\Launcher\pyw.exe", "$env:WINDIR\pyw.exe")) { if (Test-Path $p) { $py = $p; break } }
if (-not $py) { $c = Get-Command pyw -ErrorAction SilentlyContinue; if ($c) { $py = $c.Source } }
if (-not $py) { $py = Get-Item "$env:LOCALAPPDATA\Programs\Python\Python3*\pythonw.exe", "$env:ProgramFiles\Python3*\pythonw.exe" -ErrorAction SilentlyContinue | Select-Object -Last 1 -ExpandProperty FullName }
if (-not $py) { $c = Get-Command pythonw -ErrorAction SilentlyContinue; if ($c) { $py = $c.Source } }
if (-not $py) {
    Log "Python not found"
    Remove-Item $marker -ErrorAction SilentlyContinue   # next start runs the setup again
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show("Python not found. Start Clara Writer again to repeat the setup.`n`nPython non trovato. Avvia di nuovo Clara Writer per ripetere l'installazione.", "Clara Writer") | Out-Null
    exit 1
}

# ---- 5. start the server and wait until it answers
Start-Process -FilePath $py -ArgumentList "`"$app\server.py`"" -WorkingDirectory $app
$ready = $false
for ($i = 0; $i -lt 40 -and -not $ready; $i++) {
    Start-Sleep -Milliseconds 250
    try { Invoke-WebRequest "http://127.0.0.1:$port/api/ping" -UseBasicParsing -TimeoutSec 1 | Out-Null; $ready = $true } catch { }
}
if (-not $ready) { Log "server did not answer within 10 seconds" }

# ---- 6. open the editor in its own Edge window, with no browser bars
$edgeArgs = @("--app=http://127.0.0.1:$port", "--start-maximized",
              "--user-data-dir=`"$env:LOCALAPPDATA\ClaraWriter\edge`"",
              "--no-first-run", "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required")
Start-Process msedge -ArgumentList $edgeArgs
