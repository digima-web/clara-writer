﻿# ============================================================
#  Clara Writer: installs the programs it needs
#  Started by "Clara Writer.bat" the first time. It can be run
#  again at any time: it only installs what is missing.
#  Copyright (C) 2026 Francesco Bonomelli. GNU GPL v3.
# ============================================================

$ErrorActionPreference = "Continue"
$app = Split-Path -Parent $MyInvocation.MyCommand.Path
$marker = Join-Path $app "installed.ok"
$logFile = Join-Path $app "install.log"

# ---- messages (English, Italian)
$lang = (Get-UICulture).TwoLetterISOLanguageName
$M = @{
  en = @{
    title   = "Clara Writer: setup"
    head1   = "CLARA WRITER: preparing this computer"
    head2   = "Internet is needed. It takes a few minutes."
    nowinget= "'App Installer' (winget) is missing."
    winget2 = "Open Microsoft Store, search for 'App Installer', update it and start Clara Writer again."
    close   = "Press Enter to close"
    install = "Installing {0}... (Windows may ask for permission: answer Yes)"
    notinst = "{0} was not installed"
    nopandoc= "Pandoc was not installed (export to Word will not work)"
    claudedl= "Error while downloading Claude Code: {0}"
    login1  = "NOW YOU NEED TO SIGN IN TO CLAUDE."
    login2  = "A black window will open: follow the instructions and sign in with the author's Claude account."
    login3  = "When you see Claude's prompt, type  /exit  and press Enter. Clara Writer will carry on by itself."
    login4  = "Press Enter to open the sign-in window"
    loginok = "Signed in to Claude"
    loginko = "Claude sign-in not completed"
    done    = "All done. Clara Writer is opening now."
    failed  = "Something went wrong. Details in: {0}"
    retry   = "You can start Clara Writer again: it will retry only the missing parts."
  }
  it = @{
    title   = "Clara Writer: installazione"
    head1   = "CLARA WRITER: preparazione del computer"
    head2   = "Serve Internet. Ci vogliono alcuni minuti."
    nowinget= "Manca 'Programma di installazione app' (winget)."
    winget2 = "Apri Microsoft Store, cerca 'Programma di installazione app', aggiornalo e rilancia Clara Writer."
    close   = "Premi Invio per chiudere"
    install = "Installo {0}... (Windows puo' chiedere il permesso: rispondi Si)"
    notinst = "{0} non installato"
    nopandoc= "Pandoc non installato (l'esportazione in Word non funzionera')"
    claudedl= "Errore nello scaricare Claude Code: {0}"
    login1  = "ORA SERVE L'ACCESSO A CLAUDE."
    login2  = "Si apre una finestra nera: segui le istruzioni e accedi con l'account Claude dell'autore."
    login3  = "Quando vedi il cursore di Claude, scrivi  /exit  e premi Invio. Clara Writer continua da solo."
    login4  = "Premi Invio per aprire la finestra di accesso"
    loginok = "Accesso a Claude"
    loginko = "Accesso a Claude non completato"
    done    = "Tutto pronto. Ora si apre Clara Writer."
    failed  = "Qualcosa non e' andato. Dettagli in: {0}"
    retry   = "Puoi rilanciare Clara Writer: riprovera' solo le parti mancanti."
  }
}
if (-not $M.ContainsKey($lang)) { $lang = "en" }
function Msg($key, $arg = "") { return ($M[$lang][$key] -f $arg) }

$Host.UI.RawUI.WindowTitle = Msg "title"

function Say($text, $colour = "White") { Write-Host ""; Write-Host "  $text" -ForegroundColor $colour; Add-Content $logFile "$(Get-Date -Format s)  $text" }
function Good($text) { Write-Host "  [OK] $text" -ForegroundColor Green; Add-Content $logFile "$(Get-Date -Format s)  OK $text" }
function Bad($text)  { Write-Host "  [!!] $text" -ForegroundColor Red;   Add-Content $logFile "$(Get-Date -Format s)  ERROR $text" }

function Refresh-Path {
    $m = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $u = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$m;$u;$env:USERPROFILE\.local\bin"
}

function Find($name, $paths) {
    $c = Get-Command $name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($c) { return $c.Source }
    foreach ($p in $paths) { $f = Get-Item $p -ErrorAction SilentlyContinue | Select-Object -First 1; if ($f) { return $f.FullName } }
    return $null
}

function Winget-Install($id, $name, $extra = @()) {
    Say (Msg "install" $name) Yellow
    $a = @("install", "--id", $id, "-e", "--silent", "--accept-package-agreements", "--accept-source-agreements") + $extra
    & winget @a
    Refresh-Path
}

Clear-Host
Write-Host ""
Write-Host "  ==============================================" -ForegroundColor Cyan
Write-Host "    $(Msg 'head1')" -ForegroundColor Cyan
Write-Host "    $(Msg 'head2')" -ForegroundColor Cyan
Write-Host "  ==============================================" -ForegroundColor Cyan
Refresh-Path
$allGood = $true

# ---- winget
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Bad (Msg "nowinget")
    Say (Msg "winget2")
    Read-Host "  $(Msg 'close')"
    exit 1
}

# ---- 1. Git (needed by Claude Code)
$gitPaths = @("$env:ProgramFiles\Git\bin\bash.exe", "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe")
$git = Find "git" $gitPaths
if (-not $git) { Winget-Install "Git.Git" "Git"; $git = Find "git" $gitPaths }
if ($git) { Good "Git" } else { Bad (Msg "notinst" "Git"); $allGood = $false }

# ---- 2. Python (runs Clara Writer)
$pyPaths = @("$env:LOCALAPPDATA\Programs\Python\Launcher\pyw.exe", "$env:WINDIR\pyw.exe", "$env:LOCALAPPDATA\Programs\Python\Python3*\pythonw.exe", "$env:ProgramFiles\Python3*\pythonw.exe")
$py = Find "pyw" $pyPaths
if (-not $py) { Winget-Install "Python.Python.3.12" "Python" @("--scope", "user"); $py = Find "pyw" $pyPaths }
if ($py) { Good "Python" } else { Bad (Msg "notinst" "Python"); $allGood = $false }

# ---- 3. Pandoc (creates the Word files)
$pdPaths = @("$env:LOCALAPPDATA\Pandoc\pandoc.exe", "$env:ProgramFiles\Pandoc\pandoc.exe")
$pd = Find "pandoc" $pdPaths
if (-not $pd) { Winget-Install "JohnMacFarlane.Pandoc" "Pandoc"; $pd = Find "pandoc" $pdPaths }
if ($pd) { Good "Pandoc" } else { Bad (Msg "nopandoc") }

# ---- 4. Claude Code
$clPaths = @("$env:USERPROFILE\.local\bin\claude.exe")
$cl = Find "claude" $clPaths
if (-not $cl) {
    Say (Msg "install" "Claude Code") Yellow
    try { Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression } catch { Bad (Msg "claudedl" $_) }
    Refresh-Path
    $cl = Find "claude" $clPaths
}
if ($cl) { Good "Claude Code" } else { Bad (Msg "notinst" "Claude Code"); $allGood = $false }

# ---- 5. Sign in to Claude with the author's account
$config = "$env:USERPROFILE\.claude.json"
$signedIn = (Test-Path $config) -and ((Get-Content $config -Raw -ErrorAction SilentlyContinue) -match '"oauthAccount"')
if ($cl -and -not $signedIn) {
    Say (Msg "login1") Yellow
    Say (Msg "login2")
    Say (Msg "login3")
    Read-Host "  $(Msg 'login4')"
    $bash = Get-Item $gitPaths -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
    if ($bash -and -not $env:CLAUDE_CODE_GIT_BASH_PATH) { $env:CLAUDE_CODE_GIT_BASH_PATH = $bash }
    Start-Process -FilePath $cl -Wait
    $signedIn = (Test-Path $config) -and ((Get-Content $config -Raw -ErrorAction SilentlyContinue) -match '"oauthAccount"')
}
if ($signedIn) { Good (Msg "loginok") } elseif ($cl) { Bad (Msg "loginko"); $allGood = $false }

# ---- end
if ($allGood) {
    Set-Content $marker "Installed on $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
    Say (Msg "done") Green
    Start-Sleep -Seconds 3
    exit 0
} else {
    Say (Msg "failed" $logFile) Red
    Say (Msg "retry")
    Read-Host "  $(Msg 'close')"
    exit 1
}
