# ============================================================
#  Clara Writer: installazione dei programmi necessari
#  Lo avvia Clara Writer.bat la prima volta. Si puo' rilanciare
#  quando serve: installa solo quello che manca.
# ============================================================

$ErrorActionPreference = "Continue"
$Host.UI.RawUI.WindowTitle = "Clara Writer: installazione"
$programma = Split-Path -Parent $MyInvocation.MyCommand.Path
$segno = Join-Path $programma "installato.ok"
$registro = Join-Path $programma "installazione.log"

function Scrivi($testo, $colore = "White") { Write-Host ""; Write-Host "  $testo" -ForegroundColor $colore; Add-Content $registro "$(Get-Date -Format s)  $testo" }
function Bene($testo)  { Write-Host "  [OK] $testo" -ForegroundColor Green; Add-Content $registro "$(Get-Date -Format s)  OK $testo" }
function Male($testo)  { Write-Host "  [!!] $testo" -ForegroundColor Red;   Add-Content $registro "$(Get-Date -Format s)  ERRORE $testo" }

function Aggiorna-Path {
    $m = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $u = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$m;$u;$env:USERPROFILE\.local\bin"
}

function Trova($nome, $percorsi) {
    $c = Get-Command $nome -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($c) { return $c.Source }
    foreach ($p in $percorsi) { $t = Get-Item $p -ErrorAction SilentlyContinue | Select-Object -First 1; if ($t) { return $t.FullName } }
    return $null
}

function Installa-Winget($id, $nome, $extra = @()) {
    Scrivi "Installo $nome... (puo' chiedere il permesso: rispondi Si)" Yellow
    $a = @("install", "--id", $id, "-e", "--silent", "--accept-package-agreements", "--accept-source-agreements") + $extra
    & winget @a
    Aggiorna-Path
}

Clear-Host
Write-Host ""
Write-Host "  ==============================================" -ForegroundColor Cyan
Write-Host "    SCRITTOIO: preparazione del computer"        -ForegroundColor Cyan
Write-Host "    Serve Internet. Ci vogliono alcuni minuti."  -ForegroundColor Cyan
Write-Host "  ==============================================" -ForegroundColor Cyan
Aggiorna-Path
$tuttoBene = $true

# ---- winget (programma di installazione di Windows)
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Male "Manca 'Programma di installazione app' (winget)."
    Scrivi "Apri Microsoft Store, cerca 'Programma di installazione app', aggiornalo e rilancia Clara Writer."
    Read-Host "  Premi Invio per chiudere"
    exit 1
}

# ---- 1. Git (serve a Claude Code)
$git = Trova "git" @("$env:ProgramFiles\Git\bin\bash.exe", "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe")
if (-not $git) { Installa-Winget "Git.Git" "Git" ; $git = Trova "git" @("$env:ProgramFiles\Git\bin\bash.exe", "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe") }
if ($git) { Bene "Git" } else { Male "Git non installato"; $tuttoBene = $false }

# ---- 2. Python (fa funzionare Clara Writer)
$pyPercorsi = @("$env:LOCALAPPDATA\Programs\Python\Launcher\pyw.exe", "$env:WINDIR\pyw.exe", "$env:LOCALAPPDATA\Programs\Python\Python3*\pythonw.exe", "$env:ProgramFiles\Python3*\pythonw.exe")
$py = Trova "pyw" $pyPercorsi
if (-not $py) { Installa-Winget "Python.Python.3.12" "Python" @("--scope", "user"); $py = Trova "pyw" $pyPercorsi }
if ($py) { Bene "Python" } else { Male "Python non installato"; $tuttoBene = $false }

# ---- 3. Pandoc (crea i file Word)
$pdPercorsi = @("$env:LOCALAPPDATA\Pandoc\pandoc.exe", "$env:ProgramFiles\Pandoc\pandoc.exe")
$pd = Trova "pandoc" $pdPercorsi
if (-not $pd) { Installa-Winget "JohnMacFarlane.Pandoc" "Pandoc (per i file Word)"; $pd = Trova "pandoc" $pdPercorsi }
if ($pd) { Bene "Pandoc" } else { Male "Pandoc non installato (l'esportazione in Word non funzionera')"; }

# ---- 4. Claude Code
$clPercorsi = @("$env:USERPROFILE\.local\bin\claude.exe")
$cl = Trova "claude" $clPercorsi
if (-not $cl) {
    Scrivi "Installo Claude Code..." Yellow
    try { Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression } catch { Male "Errore nello scaricare Claude Code: $_" }
    Aggiorna-Path
    $cl = Trova "claude" $clPercorsi
}
if ($cl) { Bene "Claude Code" } else { Male "Claude Code non installato"; $tuttoBene = $false }

# ---- 5. Accesso a Claude con l'account dell'autore
$config = "$env:USERPROFILE\.claude.json"
$accesso = (Test-Path $config) -and ((Get-Content $config -Raw -ErrorAction SilentlyContinue) -match '"oauthAccount"')
if ($cl -and -not $accesso) {
    Scrivi "ORA SERVE L'ACCESSO A CLAUDE." Yellow
    Scrivi "Si apre una finestra nera: segui le istruzioni e accedi con l'account Claude dell'autore."
    Scrivi "Quando vedi il cursore di Claude, scrivi  /exit  e premi Invio. Clara Writer continua da solo."
    Read-Host "  Premi Invio per aprire la finestra di accesso"
    $bash = Get-Item "$env:ProgramFiles\Git\bin\bash.exe", "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
    if ($bash -and -not $env:CLAUDE_CODE_GIT_BASH_PATH) { $env:CLAUDE_CODE_GIT_BASH_PATH = $bash }
    Start-Process -FilePath $cl -Wait
    $accesso = (Test-Path $config) -and ((Get-Content $config -Raw -ErrorAction SilentlyContinue) -match '"oauthAccount"')
}
if ($accesso) { Bene "Accesso a Claude" } elseif ($cl) { Male "Accesso a Claude non completato"; $tuttoBene = $false }

# ---- fine
if ($tuttoBene) {
    Set-Content $segno "Installazione completata il $(Get-Date -Format 'dd/MM/yyyy HH:mm')"
    Scrivi "Tutto pronto. Ora si apre Clara Writer." Green
    Start-Sleep -Seconds 3
    exit 0
} else {
    Scrivi "Qualcosa non e' andato. Dettagli in: $registro" Red
    Scrivi "Puoi rilanciare Clara Writer: riprovera' solo le parti mancanti."
    Read-Host "  Premi Invio per chiudere"
    exit 1
}
