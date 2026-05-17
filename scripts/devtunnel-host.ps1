# Запускает devtunnel host в бесконечном restart-loop'e.
# Microsoft relay периодически дропает SSH-канал (ConnectionLost), это известная
# проблема devtunnels. При обычном `devtunnel host` после дропа клиент умирает
# и сайт отдаёт 502 пока юзер не перезапустит. Этот скрипт перезапускает
# автоматически за ~2 секунды.
#
# Запуск:
#   pwsh scripts\devtunnel-host.ps1
# или из обычного PowerShell:
#   powershell -File scripts\devtunnel-host.ps1
#
# Tunnel ID жёстко: new-field-48b02hk (см. memory project-devtunnel-id).

$TUNNEL_ID = 'new-field-48b02hk'

while ($true) {
    Write-Host "[$(Get-Date -Format HH:mm:ss)] starting devtunnel host $TUNNEL_ID..." -ForegroundColor Cyan
    & devtunnel host $TUNNEL_ID
    $code = $LASTEXITCODE
    Write-Host "[$(Get-Date -Format HH:mm:ss)] devtunnel exited (code $code), restart in 2s..." -ForegroundColor Yellow
    Start-Sleep -Seconds 2
}
