$ErrorActionPreference = 'Stop'

function Resolve-CaddyPath {
    $command = Get-Command caddy -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }

    $candidate = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter caddy.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($candidate) { return $candidate.FullName }
    throw 'Caddy is not installed. Run: winget install CaddyServer.Caddy'
}

function Assert-PortFree([int]$Port) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $listener) { return }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
    throw "Port $Port is already in use (PID $($listener.OwningProcess): $($process.CommandLine)). Stop the existing server first."
}

function Get-PublicIPv4 {
    foreach ($address in Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object { $_.AddressState -eq 'Preferred' }) {
        $bytes = ([Net.IPAddress]::Parse($address.IPAddress)).GetAddressBytes()
        $private = $bytes[0] -eq 10 -or $bytes[0] -eq 127 -or $bytes[0] -eq 0 `
            -or ($bytes[0] -eq 100 -and $bytes[1] -ge 64 -and $bytes[1] -le 127) `
            -or ($bytes[0] -eq 169 -and $bytes[1] -eq 254) `
            -or ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) `
            -or ($bytes[0] -eq 192 -and $bytes[1] -eq 168)
        if (-not $private) { return $address.IPAddress }
    }
    throw 'No public IPv4 address was found on this PC.'
}

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

$publicAddress = Get-PublicIPv4

Assert-PortFree 80
Assert-PortFree 443
Assert-PortFree 3000

$securePassword = Read-Host 'Friend access password' -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$launcherProcess = $null
$caddyProcess = $null

try {
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    if ([string]::IsNullOrWhiteSpace($plainPassword) -or $plainPassword.Length -lt 10) {
        throw 'Use an access password with at least 10 characters.'
    }

    $runtimeDir = Join-Path $projectRoot '.tmp\public-runtime'
    New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

    $env:MINIGAME_PASSWORD = $plainPassword
    $env:MINIGAME_COOKIE_SECURE = '1'
    $env:MINIGAME_PUBLIC_URL = "https://$publicAddress"
    $env:MINIGAME_PUBLIC_IP = $publicAddress
    $env:MINIGAME_ACME_CA = 'https://acme-v02.api.letsencrypt.org/directory'
    $env:MINIGAME_UPSTREAM = '127.0.0.1:3000'

    $launcherProcess = Start-Process -FilePath node -ArgumentList @('launcher/server.js') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $runtimeDir 'launcher.out.log') `
        -RedirectStandardError (Join-Path $runtimeDir 'launcher.err.log')

    $launcherReady = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if ($launcherProcess.HasExited) { throw 'Launcher failed. Check .tmp\public-runtime\launcher.err.log.' }
        $client = [Net.Sockets.TcpClient]::new()
        try {
            $client.Connect('127.0.0.1', 3000)
            if ($client.Connected) { $launcherReady = $true; break }
        } catch {} finally { $client.Dispose() }
        Start-Sleep -Milliseconds 250
    }
    if (-not $launcherReady) { throw 'Launcher did not become ready within 15 seconds.' }

    $caddyPath = Resolve-CaddyPath
    $caddyProcess = Start-Process -FilePath $caddyPath -ArgumentList @('run','--config','infra/Caddyfile.ip','--adapter','caddyfile') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $runtimeDir 'caddy.out.log') `
        -RedirectStandardError (Join-Path $runtimeDir 'caddy.err.log')

    $httpsReady = $false
    for ($attempt = 0; $attempt -lt 120; $attempt++) {
        if ($caddyProcess.HasExited) { throw 'HTTPS proxy failed. Check .tmp\public-runtime\caddy.err.log.' }
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri "https://$publicAddress/_auth/login" -TimeoutSec 3
            if ($response.StatusCode -eq 200) { $httpsReady = $true; break }
        } catch {}
        Start-Sleep -Milliseconds 500
    }
    if (-not $httpsReady) { throw 'Trusted HTTPS did not become ready within 60 seconds.' }

    Write-Host ''
    Write-Host 'Minigame Paradise public server is ready.' -ForegroundColor Green
    Write-Host "Invite URL: https://$publicAddress" -ForegroundColor Cyan
    Write-Host 'Keep this window open. Press Ctrl+C to stop.' -ForegroundColor DarkGray
    Write-Host ''

    while (-not $launcherProcess.HasExited -and -not $caddyProcess.HasExited) {
        Start-Sleep -Seconds 1
    }
    if ($caddyProcess.HasExited) { throw 'HTTPS proxy stopped. Check .tmp\public-runtime\caddy.err.log.' }
    throw 'Launcher stopped. Check .tmp\public-runtime\launcher.err.log.'
}
finally {
    if ($caddyProcess -and -not $caddyProcess.HasExited) { Stop-Process -Id $caddyProcess.Id }
    if ($launcherProcess -and -not $launcherProcess.HasExited) { Stop-Process -Id $launcherProcess.Id }
    Remove-Item Env:\MINIGAME_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:\MINIGAME_COOKIE_SECURE -ErrorAction SilentlyContinue
    Remove-Item Env:\MINIGAME_PUBLIC_URL -ErrorAction SilentlyContinue
    Remove-Item Env:\MINIGAME_PUBLIC_IP -ErrorAction SilentlyContinue
    Remove-Item Env:\MINIGAME_ACME_CA -ErrorAction SilentlyContinue
    Remove-Item Env:\MINIGAME_UPSTREAM -ErrorAction SilentlyContinue
    $plainPassword = $null
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
}
