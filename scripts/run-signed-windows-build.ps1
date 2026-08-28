$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$privateKeyPath = Join-Path $env:USERPROFILE ".ticketpro\updater.key"
$version = (Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json).version
$Host.UI.RawUI.WindowTitle = "TicketPro Build signe $version"

if (-not (Test-Path -LiteralPath $privateKeyPath)) {
  throw "Clé privée Updater introuvable : $privateKeyPath"
}

Set-Location -LiteralPath $projectRoot
$securePassword = Read-Host "Mot de passe de la clé Updater TicketPro" -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)

try {
  $env:TAURI_SIGNING_PRIVATE_KEY_PATH = $privateKeyPath
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)

  $validationFile = Join-Path $env:TEMP ("ticketpro-updater-key-check-{0}.bin" -f $PID)
  $validationSignature = "$validationFile.sig"
  try {
    [IO.File]::WriteAllBytes(
      $validationFile,
      [Convert]::FromBase64String("VGlja2V0UHJvIHVwZGF0ZXIga2V5IGNoZWNr")
    )
    $null = npm.cmd run tauri -- signer sign -f $privateKeyPath $validationFile 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "Mot de passe Updater incorrect. Le build n'a pas ete lance."
    }
    Write-Host "Cle Updater et mot de passe verifies." -ForegroundColor Green
  } finally {
    Remove-Item -LiteralPath $validationFile -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $validationSignature -Force -ErrorAction SilentlyContinue
  }

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
