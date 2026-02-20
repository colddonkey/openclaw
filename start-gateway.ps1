#!/usr/bin/env pwsh
# Start OpenClaw gateway from local dev copy with auto-restart watchdog
# Usage: powershell -File start-gateway.ps1
#   -Visible  : Ensure the terminal window stays visible (re-launches in a new window if needed)

param(
    [switch]$Visible
)

$ErrorActionPreference = "Stop"
$repoDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoDir

# If -Visible flag is set and we detect we're running without a visible console,
# re-launch in a new visible PowerShell window.
if ($Visible -and -not $env:OPENCLAW_GATEWAY_RELAUNCHED) {
    $env:OPENCLAW_GATEWAY_RELAUNCHED = "1"
    $Host.UI.RawUI.WindowTitle = "OpenClaw Gateway"
    Start-Process pwsh -ArgumentList "-NoExit", "-File", $MyInvocation.MyCommand.Path -WorkingDirectory $repoDir
    exit 0
}

# Set window title for easy identification
try { $Host.UI.RawUI.WindowTitle = "OpenClaw Gateway (port 18789)" } catch {}

$logDir = "$env:USERPROFILE\.openclaw\logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$logFile = "$logDir\gateway.log"
$maxRestarts = 50
$restartDelay = 5
$restartCount = 0

while ($restartCount -lt $maxRestarts) {
    $restartCount++
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

    if ($restartCount -gt 1) {
        "[$ts] WATCHDOG: Restarting gateway (attempt $restartCount/$maxRestarts)" | Tee-Object -FilePath $logFile -Append
        Start-Sleep -Seconds $restartDelay
    } else {
        "[$ts] WATCHDOG: Starting gateway" | Tee-Object -FilePath $logFile -Append
    }

    & "C:\Program Files\nodejs\node.exe" --experimental-sqlite --disable-warning=ExperimentalWarning scripts/run-node.mjs gateway run --port 18789 --force 2>&1 | Tee-Object -FilePath $logFile -Append
    $exitCode = $LASTEXITCODE
    $endTs = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "[$endTs] WATCHDOG: Gateway exited with code $exitCode" | Tee-Object -FilePath $logFile -Append
}

"[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] WATCHDOG: Max restarts reached ($maxRestarts). Stopping." | Tee-Object -FilePath $logFile -Append
