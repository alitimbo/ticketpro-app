param(
  [Parameter(Mandatory = $true)]
  [string]$RouterHost,

  [int]$Port = 8728,

  [int]$TimeoutSeconds = 5
)

$ErrorActionPreference = "Stop"

Write-Host "TicketPro - diagnostic RouterOS" -ForegroundColor Cyan
Write-Host "Cible : ${RouterHost}:${Port}"

try {
  $addresses = [System.Net.Dns]::GetHostAddresses($RouterHost)
  Write-Host "Résolution : OK ($($addresses -join ', '))" -ForegroundColor Green
} catch {
  Write-Host "Résolution : ÉCHEC - $($_.Exception.Message)" -ForegroundColor Red
  exit 2
}

$client = [System.Net.Sockets.TcpClient]::new()
try {
  $connectTask = $client.ConnectAsync($RouterHost, $Port)
  if (-not $connectTask.Wait([TimeSpan]::FromSeconds($TimeoutSeconds))) {
    throw "Délai de connexion dépassé après ${TimeoutSeconds}s"
  }
  if (-not $client.Connected) {
    throw "Connexion TCP non établie"
  }
  Write-Host "TCP ${Port} : OUVERT" -ForegroundColor Green
  Write-Host "Le réseau atteint RouterOS. Si TicketPro échoue encore, vérifiez les identifiants et les permissions du compte MikroTik." -ForegroundColor Yellow
  exit 0
} catch {
  Write-Host "TCP ${Port} : FERMÉ OU INACCESSIBLE - $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Vérifiez /ip service api, le firewall input, l'adresse IP et que le PC est sur le bon réseau." -ForegroundColor Yellow
  exit 3
} finally {
  $client.Dispose()
}
