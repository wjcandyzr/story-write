# deploy.ps1 - AI Novel stack lifecycle (PowerShell)
#
#   .\deploy.ps1 start      Bring up postgres+redis (docker), nest dev, vite dev
#   .\deploy.ps1 stop       Stop nest + vite, leave docker running
#   .\deploy.ps1 down       Stop everything, including docker compose
#   .\deploy.ps1 restart    stop + start
#   .\deploy.ps1 status     Show what is running
#   .\deploy.ps1 logs api   Tail nest log
#   .\deploy.ps1 logs web   Tail vite log
#
# Execution policy on first run -- choose one:
#   1. one-shot:    powershell -ExecutionPolicy Bypass -File .\deploy.ps1 start
#   2. permanent:   Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned

param(
    [Parameter(Position = 0)]
    [string]$Command = 'help',

    [Parameter(Position = 1)]
    [string]$Arg
)

$ErrorActionPreference = 'Stop'

# ---------- paths ----------
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RunDir  = Join-Path $RootDir '.run'
$PidApi  = Join-Path $RunDir 'api.pid'
$PidWeb  = Join-Path $RunDir 'web.pid'
$LogApi  = Join-Path $RunDir 'api.log'
$LogWeb  = Join-Path $RunDir 'web.log'
New-Item -ItemType Directory -Path $RunDir -Force | Out-Null

$ApiPort = 3000
$WebPort = 4000

# ---------- helpers ----------

function W-Step ($m) { Write-Host ">> $m" -ForegroundColor Cyan }
function W-Ok   ($m) { Write-Host "[OK] $m" -ForegroundColor Green }
function W-Warn ($m) { Write-Host "[..] $m" -ForegroundColor Yellow }
function W-Bad  ($m) { Write-Host "[!!] $m" -ForegroundColor Red }
function W-Dim  ($m) { Write-Host "    $m" -ForegroundColor DarkGray }

function Test-PidAlive {
    param([string]$PidFile)
    if (-not (Test-Path $PidFile)) { return $false }
    $procId = [int](Get-Content -Raw $PidFile).Trim()
    if ($procId -le 0) { return $false }
    try {
        Get-Process -Id $procId -ErrorAction Stop | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Get-PidFromFile {
    param([string]$PidFile)
    if (-not (Test-Path $PidFile)) { return 0 }
    return [int](Get-Content -Raw $PidFile).Trim()
}

function Test-PortInUse {
    param([int]$Port)
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return [bool]$conn
}

function Stop-Tree {
    param([string]$PidFile, [string]$Name)
    if (-not (Test-PidAlive $PidFile)) {
        W-Warn "$Name not running"
        if (Test-Path $PidFile) { Remove-Item $PidFile -Force }
        return
    }
    $procId = Get-PidFromFile $PidFile
    W-Step "stop $Name (pid=$procId, including child processes)"
    # taskkill /T kills the whole tree -- npm.cmd spawns node.exe; without /T
    # the parent dies but node keeps holding the port.
    & taskkill /PID $procId /T /F 2>$null | Out-Null
    Start-Sleep -Milliseconds 300
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

function Start-Bg {
    param(
        [string]$WorkDir,
        [string]$PidFile,
        [string]$LogFile,
        [string]$Display,
        [string]$NpmScript
    )
    W-Step "start $Display -> $LogFile"
    # cmd.exe /c wrap so stdout + stderr both land in the log file; no window.
    $proc = Start-Process -FilePath 'cmd.exe' `
        -ArgumentList '/c', "npm run $NpmScript > `"$LogFile`" 2>&1" `
        -WorkingDirectory $WorkDir `
        -PassThru `
        -WindowStyle Hidden
    $proc.Id | Set-Content -Path $PidFile -Encoding ASCII
    Start-Sleep -Milliseconds 400
    W-Dim "pid=$($proc.Id)"
}

# ---------- starters ----------

function Start-Docker {
    W-Step 'docker compose up -d postgres redis'
    Push-Location $RootDir
    try { docker compose up -d postgres redis } finally { Pop-Location }
}

function Start-Api {
    if (Test-PidAlive $PidApi) {
        W-Warn "nest already running (pid=$(Get-PidFromFile $PidApi))"
        return
    }
    if (Test-PortInUse $ApiPort) {
        W-Bad "port :$ApiPort is in use by another process; free it first"
        throw 'port in use'
    }
    if (-not (Test-Path (Join-Path $RootDir 'node_modules'))) {
        W-Step 'first run: npm install (backend)'
        Push-Location $RootDir
        try { npm install } finally { Pop-Location }
    }
    Start-Bg -WorkDir $RootDir -PidFile $PidApi -LogFile $LogApi `
            -Display 'nest (dev)' -NpmScript 'start:dev'
    W-Dim 'compiling, takes 5~15s'
}

function Start-Web {
    if (Test-PidAlive $PidWeb) {
        W-Warn "vite already running (pid=$(Get-PidFromFile $PidWeb))"
        return
    }
    if (Test-PortInUse $WebPort) {
        W-Bad "port :$WebPort is in use by another process; free it first"
        throw 'port in use'
    }
    $webDir = Join-Path $RootDir 'web'
    if (-not (Test-Path (Join-Path $webDir 'node_modules'))) {
        W-Step 'first run: npm install (frontend)'
        Push-Location $webDir
        try { npm install } finally { Pop-Location }
    }
    Start-Bg -WorkDir $webDir -PidFile $PidWeb -LogFile $LogWeb `
            -Display 'vite (dev)' -NpmScript 'dev'
}

function Show-Status {
    if (Test-PidAlive $PidApi) {
        W-Ok "nest  : running (pid=$(Get-PidFromFile $PidApi))  -> http://localhost:$ApiPort"
    } else {
        W-Warn 'nest  : stopped'
    }
    if (Test-PidAlive $PidWeb) {
        W-Ok "vite  : running (pid=$(Get-PidFromFile $PidWeb))  -> http://localhost:$WebPort"
    } else {
        W-Warn 'vite  : stopped'
    }
    Write-Host ''
    Push-Location $RootDir
    try { docker compose ps } finally { Pop-Location }
}

function Tail-Log {
    param([string]$Which)
    $file = switch ($Which) {
        'api'   { $LogApi }
        'web'   { $LogWeb }
        default {
            W-Bad 'usage: deploy.ps1 logs api|web'
            exit 1
        }
    }
    if (-not (Test-Path $file)) {
        W-Warn "$file does not exist yet -- service has not been started"
        exit 1
    }
    Get-Content -Path $file -Wait -Tail 80
}

function Show-Help {
    @"
deploy.ps1 - AI Novel stack lifecycle

  .\deploy.ps1 start        Start postgres+redis (docker) + nest dev + vite dev
  .\deploy.ps1 stop         Stop nest + vite, keep docker
  .\deploy.ps1 down         Stop nest + vite, plus docker compose down (volumes kept)
  .\deploy.ps1 restart      stop + start
  .\deploy.ps1 status       Show running state
  .\deploy.ps1 logs api     Tail nest log (Ctrl+C to exit)
  .\deploy.ps1 logs web     Tail vite log

URLs:
  Frontend: http://localhost:$WebPort/
  Backend:  http://localhost:$ApiPort/api
  Swagger:  http://localhost:$ApiPort/docs

Execution policy:
  If you see "running scripts is disabled", run one of:
    Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
    powershell -ExecutionPolicy Bypass -File .\deploy.ps1 start
"@ | Write-Host
}

# ---------- main ----------

switch ($Command) {
    'start' {
        Start-Docker
        Start-Api
        Start-Web
        Write-Host ''
        W-Ok 'stack is up'
        Write-Host "    Frontend: http://localhost:$WebPort/"
        Write-Host "    Backend:  http://localhost:$ApiPort/api"
        Write-Host "    Swagger:  http://localhost:$ApiPort/docs"
        Write-Host ''
        W-Dim 'logs:    .\deploy.ps1 logs api  /  .\deploy.ps1 logs web'
        W-Dim 'stop:    .\deploy.ps1 stop  (keep docker)  /  .\deploy.ps1 down  (kill all)'
    }
    'stop' {
        Stop-Tree -PidFile $PidWeb -Name 'vite'
        Stop-Tree -PidFile $PidApi -Name 'nest'
        W-Ok 'app layer stopped (postgres / redis containers still running)'
    }
    'down' {
        Stop-Tree -PidFile $PidWeb -Name 'vite'
        Stop-Tree -PidFile $PidApi -Name 'nest'
        W-Step 'docker compose down'
        Push-Location $RootDir
        try { docker compose down } finally { Pop-Location }
        W-Ok 'everything stopped (volumes preserved)'
    }
    'restart' {
        & $MyInvocation.MyCommand.Path 'stop'
        & $MyInvocation.MyCommand.Path 'start'
    }
    'status' { Show-Status }
    'logs'   { Tail-Log -Which $Arg }
    default  { Show-Help }
}
