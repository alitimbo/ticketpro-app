param(
  [switch]$SkipCargo
)

$ErrorActionPreference = "Stop"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outputDirectory = Join-Path $PSScriptRoot "..\output\lab"
$logPath = Join-Path $outputDirectory "sprint5-automated-$timestamp.log"
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

function Invoke-GateStep {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][scriptblock]$Command
  )
  Write-Host ""
  Write-Host "=== $Name ===" -ForegroundColor Cyan
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "Etape Sprint 5 en echec : $Name (code $LASTEXITCODE)"
  }
}

Start-Transcript -Path $logPath -Force | Out-Null
try {
  Invoke-GateStep "Charge SQLite 1000 et 5000 vouchers" { npm.cmd run lab:sprint5:vouchers }
  Invoke-GateStep "Tests frontend et domaine" { npm.cmd test }
  Invoke-GateStep "Verification TypeScript" { npm.cmd run type-check }
  Invoke-GateStep "Tests API, VPN et isolation" { npm.cmd run test:license-api }
  Invoke-GateStep "Audit dependances npm" { npm.cmd audit --audit-level=moderate }
  if (-not $SkipCargo) {
    Invoke-GateStep "Verification Rust et Tauri" { cargo check --manifest-path src-tauri\Cargo.toml }
  }
  Write-Host ""
  Write-Host "SPRINT 5 AUTOMATED GATE: PASSED" -ForegroundColor Green
  Write-Host "Rapport : $logPath"
} finally {
  Stop-Transcript | Out-Null
}
