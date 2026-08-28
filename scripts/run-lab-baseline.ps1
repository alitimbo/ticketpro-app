$ErrorActionPreference = "Stop"

Set-Location (Resolve-Path (Join-Path $PSScriptRoot ".."))

$checks = @(
  @{ Label = "Tests application"; Command = { npm.cmd test -- --run } },
  @{ Label = "Types TypeScript"; Command = { npm.cmd run type-check } },
  @{ Label = "Tests API et hub VPN"; Command = { npm.cmd run test:license-api } },
  @{ Label = "Composants WireGuard"; Command = { npm.cmd run vpn:components:check } },
  @{ Label = "Tests Rust"; Command = { cargo test --manifest-path src-tauri\Cargo.toml } },
  @{ Label = "Compilation Rust"; Command = { cargo check --manifest-path src-tauri\Cargo.toml } },
  @{ Label = "Build frontend"; Command = { npm.cmd run build } }
)

foreach ($check in $checks) {
  Write-Host "`n=== $($check.Label) ===" -ForegroundColor Cyan
  & $check.Command
  if ($LASTEXITCODE -ne 0) {
    throw "Échec de la baseline : $($check.Label) (code $LASTEXITCODE)."
  }
}

Write-Host "`nBaseline laboratoire validée." -ForegroundColor Green
