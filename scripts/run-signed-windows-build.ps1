$ErrorActionPreference = "Stop"

# Améliore l'affichage UTF-8 dans le terminal
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()

$projectRoot = Split-Path -Parent $PSScriptRoot

$privateKeyPath = Join-Path $env:USERPROFILE ".ticketpro\updater.key"
$tauriCmd = Join-Path $projectRoot "node_modules\.bin\tauri.cmd"

$version = (
  Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw |
  ConvertFrom-Json
).version

$Host.UI.RawUI.WindowTitle = "TicketPro Build signé $version"

if (-not (Test-Path -LiteralPath $privateKeyPath)) {
  throw "Clé privée Updater introuvable : $privateKeyPath"
}

if (-not (Test-Path -LiteralPath $tauriCmd)) {
  throw "Tauri CLI introuvable : $tauriCmd"
}

Set-Location -LiteralPath $projectRoot

$securePassword = Read-Host "Mot de passe de la clé Updater TicketPro" -AsSecureString

$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)

try {
  $env:TAURI_SIGNING_PRIVATE_KEY_PATH = $privateKeyPath

  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD =
  [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)

  $validationFile = Join-Path $env:TEMP (
    "ticketpro-updater-key-check-{0}.bin" -f $PID
  )

  $validationSignature = "$validationFile.sig"

  try {
    [IO.File]::WriteAllBytes(
      $validationFile,
      [Convert]::FromBase64String(
        "VGlja2V0UHJvIHVwZGF0ZXIga2V5IGNoZWNr"
      )
    )

    Write-Host "Vérification de la clé Updater..." -ForegroundColor Cyan

    # Important :
    # On appelle Tauri directement au lieu de passer par npm.
    # Cela évite que les "npm notice" soient interprétés comme
    # NativeCommandError avec ErrorActionPreference = Stop.
    & $tauriCmd signer sign `
      -f $privateKeyPath `
      $validationFile

    $signExitCode = $LASTEXITCODE

    if ($signExitCode -ne 0) {
      throw "Mot de passe Updater incorrect ou signature impossible. Code : $signExitCode"
    }

    if (-not (Test-Path -LiteralPath $validationSignature)) {
      throw "La validation de la clé n'a produit aucune signature."
    }

    Write-Host "Clé Updater et mot de passe vérifiés." -ForegroundColor Green
  }
  finally {
    Remove-Item `
      -LiteralPath $validationFile `
      -Force `
      -ErrorAction SilentlyContinue

    Remove-Item `
      -LiteralPath $validationSignature `
      -Force `
      -ErrorAction SilentlyContinue
  }

  Write-Host ""
  Write-Host "Construction de TicketPro $version..." -ForegroundColor Cyan
  Write-Host ""

  & npm.cmd run release:build:windows

  $buildExitCode = $LASTEXITCODE

  if ($buildExitCode -ne 0) {
    throw "Le build Windows a échoué avec le code $buildExitCode."
  }

  Write-Host ""
  Write-Host "BUILD TICKETPRO $version TERMINÉ AVEC SUCCÈS" -ForegroundColor Green
}
finally {
  Remove-Item `
    Env:\TAURI_SIGNING_PRIVATE_KEY_PASSWORD `
    -ErrorAction SilentlyContinue

  Remove-Item `
    Env:\TAURI_SIGNING_PRIVATE_KEY_PATH `
    -ErrorAction SilentlyContinue

  if ($passwordPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
}

Read-Host "Appuyez sur Entrée pour fermer cette fenêtre"