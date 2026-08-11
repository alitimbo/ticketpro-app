$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$privateKeyPath = Join-Path $env:USERPROFILE ".ticketpro\updater.key"
$version = (Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json).version

if (-not (Test-Path -LiteralPath $privateKeyPath)) {
  throw "Clé privée Updater introuvable : $privateKeyPath"
}

Set-Location -LiteralPath $projectRoot
$securePassword = Read-Host "Mot de passe de la clé Updater TicketPro" -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)

try {
  $env:TAURI_SIGNING_PRIVATE_KEY_PATH = $privateKeyPath
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  npm.cmd run release:build:windows
  if ($LASTEXITCODE -ne 0) {
    throw "Le build Windows a échoué avec le code $LASTEXITCODE."
  }
  Write-Host ""
  Write-Host "BUILD TICKETPRO $version TERMINÉ AVEC SUCCÈS" -ForegroundColor Green
} finally {
  Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY_PATH -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
}

Read-Host "Appuyez sur Entrée pour fermer cette fenêtre"
