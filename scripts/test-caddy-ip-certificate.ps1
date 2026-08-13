param([switch]$Production)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $projectRoot
$publicAddress = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
        if ($_.AddressState -ne 'Preferred') { return $false }
        $bytes = ([Net.IPAddress]::Parse($_.IPAddress)).GetAddressBytes()
        return -not ($bytes[0] -eq 10 -or $bytes[0] -eq 127 -or $bytes[0] -eq 0 `
            -or ($bytes[0] -eq 100 -and $bytes[1] -ge 64 -and $bytes[1] -le 127) `
            -or ($bytes[0] -eq 169 -and $bytes[1] -eq 254) `
            -or ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) `
            -or ($bytes[0] -eq 192 -and $bytes[1] -eq 168))
    } | Select-Object -First 1 -ExpandProperty IPAddress

$env:MINIGAME_PUBLIC_IP = $publicAddress
$env:MINIGAME_ACME_CA = if ($Production) {
    'https://acme-v02.api.letsencrypt.org/directory'
} else {
    'https://acme-staging-v02.api.letsencrypt.org/directory'
}
$env:MINIGAME_UPSTREAM = '127.0.0.1:39999'
$logDir = Join-Path $projectRoot '.tmp\caddy-staging'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$outLog = Join-Path $logDir 'out.log'
$errLog = Join-Path $logDir 'err.log'
$process = $null

try {
    $process = Start-Process -FilePath (Get-Command caddy).Source -ArgumentList @('run', '--config', 'infra/Caddyfile.ip', '--adapter', 'caddyfile') `
        -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $outLog -RedirectStandardError $errLog
    $issued = $false
    for ($attempt = 0; $attempt -lt 80; $attempt++) {
        if ($process.HasExited) { break }
        $logs = (Get-Content $outLog -Raw -ErrorAction SilentlyContinue) + (Get-Content $errLog -Raw -ErrorAction SilentlyContinue)
        if ($logs -match 'certificate obtained successfully') { $issued = $true; break }
        if ($logs -match 'authorization failed|could not get certificate') { break }
        Start-Sleep -Seconds 1
    }
    if (-not $issued) { throw "Staging certificate issuance failed`n$logs" }
    Write-Host "Caddy $(if ($Production) {'production'} else {'staging'}) public IP certificate PASS"
}
finally {
    if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id }
    Remove-Item Env:\MINIGAME_PUBLIC_IP, Env:\MINIGAME_ACME_CA, Env:\MINIGAME_UPSTREAM -ErrorAction SilentlyContinue
}
