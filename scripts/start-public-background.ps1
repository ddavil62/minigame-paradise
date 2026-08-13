$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$runtimeDir = Join-Path $projectRoot '.tmp\public-runtime'
$publicAddress = '112.155.2.238'
$launcherProcess = $null
$caddyProcess = $null

function Assert-PortFree([int]$Port) {
    if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
        throw "Port $Port is already in use."
    }
}

Set-Location $projectRoot
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

foreach ($port in 80, 443, 3000) { Assert-PortFree $port }

$randomBytes = New-Object byte[] 18
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($randomBytes)
$accessPassword = [Convert]::ToBase64String($randomBytes).TrimEnd('=').Replace('+', 'A').Replace('/', 'B')

$env:MINIGAME_PASSWORD = $accessPassword
$env:MINIGAME_COOKIE_SECURE = '1'
$env:MINIGAME_PUBLIC_URL = "https://$publicAddress"
$env:MINIGAME_PUBLIC_IP = $publicAddress
$env:MINIGAME_ACME_CA = 'https://acme-v02.api.letsencrypt.org/directory'
$env:MINIGAME_UPSTREAM = '127.0.0.1:3000'

try {
    $launcherProcess = Start-Process node -ArgumentList 'launcher/server.js' -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $runtimeDir 'launcher.out.log') `
        -RedirectStandardError (Join-Path $runtimeDir 'launcher.err.log')

    $launcherReady = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if ($launcherProcess.HasExited) { throw 'Launcher exited during startup.' }
        $listener = Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue |
            Where-Object { $_.OwningProcess -eq $launcherProcess.Id }
        if ($listener) { $launcherReady = $true; break }
        Start-Sleep -Milliseconds 250
    }
    if (-not $launcherReady) { throw 'Launcher did not bind port 3000.' }

    $caddyPath = (Get-Command caddy -ErrorAction Stop).Source
    $caddyProcess = Start-Process $caddyPath -ArgumentList @('run', '--config', 'infra/Caddyfile.ip', '--adapter', 'caddyfile') `
        -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $runtimeDir 'caddy.out.log') `
        -RedirectStandardError (Join-Path $runtimeDir 'caddy.err.log')

    $httpsReady = $false
    for ($attempt = 0; $attempt -lt 120; $attempt++) {
        if ($caddyProcess.HasExited) { throw 'Caddy exited during startup.' }
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri "https://$publicAddress/_auth/login" -TimeoutSec 3
            if ($response.StatusCode -eq 200) { $httpsReady = $true; break }
        } catch {}
        Start-Sleep -Milliseconds 500
    }
    if (-not $httpsReady) { throw 'Trusted HTTPS did not become ready.' }

    Write-Output "PUBLIC_URL=https://$publicAddress"
    Write-Output "ACCESS_PASSWORD=$accessPassword"
    Write-Output "LAUNCHER_PID=$($launcherProcess.Id)"
    Write-Output "CADDY_PID=$($caddyProcess.Id)"
}
catch {
    if ($caddyProcess -and -not $caddyProcess.HasExited) { Stop-Process -Id $caddyProcess.Id }
    if ($launcherProcess -and -not $launcherProcess.HasExited) { Stop-Process -Id $launcherProcess.Id }
    throw
}
finally {
    @(
        'MINIGAME_PASSWORD', 'MINIGAME_COOKIE_SECURE', 'MINIGAME_PUBLIC_URL',
        'MINIGAME_PUBLIC_IP', 'MINIGAME_ACME_CA', 'MINIGAME_UPSTREAM'
    ) | ForEach-Object { Remove-Item "Env:\$_" -ErrorAction SilentlyContinue }
}
