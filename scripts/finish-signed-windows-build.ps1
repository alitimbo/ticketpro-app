$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$privateKeyPath = Join-Path $env:USERPROFILE ".ticketpro\updater.key"
$version = (Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json).version
$installerPath = Join-Path $projectRoot "src-tauri\target\release\bundle\nsis\TicketPro_${version}_x64-setup.exe"
$logPath = Join-Path $projectRoot "src-tauri\target\release\bundle\nsis\TicketPro-${version}-signing.log"

if (-not (Test-Path -LiteralPath $privateKeyPath)) {
  throw "Clé privée Updater introuvable : $privateKeyPath"
}
if (-not (Test-Path -LiteralPath $installerPath)) {
  throw "Installateur $version introuvable : $installerPath"
}

Set-Location -LiteralPath $projectRoot
$securePassword = Read-Host "Mot de passe de la clé Updater TicketPro" -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)

try {
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  $signOutput = npm.cmd run tauri -- signer sign -f $privateKeyPath $installerPath 2>&1
  $signOutput | Out-File -LiteralPath $logPath -Encoding utf8
  $signOutput | ForEach-Object { Write-Host $_ }
  if ($LASTEXITCODE -ne 0) {
    throw "La signature Updater a échoué avec le code $LASTEXITCODE."
  }
  $renameOutput = node scripts/rename-windows-installer.mjs 2>&1
  $renameOutput | Add-Content -LiteralPath $logPath -Encoding utf8
  $renameOutput | ForEach-Object { Write-Host $_ }
  if ($LASTEXITCODE -ne 0) {
    throw "La finalisation de l'installateur a échoué avec le code $LASTEXITCODE."
  }
  Write-Host ""
  Write-Host "INSTALLATEUR TICKETPRO $version SIGNÉ ET FINALISÉ" -ForegroundColor Green
} finally {
  Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
}

Read-Host "Appuyez sur Entrée pour fermer cette fenêtre"
