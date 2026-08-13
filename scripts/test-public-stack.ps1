param(
    [string]$PublicAddress = '112.155.2.238',
    [int]$UpstreamPort = 31850
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$runtimeDir = Join-Path $projectRoot '.tmp\public-stack-test'
$testPassword = 'integration-only-password-4831'
$launcherProcess = $null
$caddyProcess = $null

function Resolve-CaddyPath {
    $command = Get-Command caddy -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $candidate = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter caddy.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($candidate) { return $candidate.FullName }
    throw 'Caddy is not installed.'
}

function Assert-PortFree([int]$Port) {
    if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
        throw "Port $Port is already in use."
    }
}

Set-Location $projectRoot
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

try {
    Assert-PortFree 80
    Assert-PortFree 443
    Assert-PortFree $UpstreamPort

    $env:MINIGAME_PASSWORD = $testPassword
    $env:MINIGAME_COOKIE_SECURE = '1'
    $env:MINIGAME_PUBLIC_URL = "https://$PublicAddress"
    $env:MINIGAME_PUBLIC_IP = $PublicAddress
    $env:MINIGAME_ACME_CA = 'https://acme-v02.api.letsencrypt.org/directory'
    $env:MINIGAME_UPSTREAM = "127.0.0.1:$UpstreamPort"

    $launcherProcess = Start-Process -FilePath node -ArgumentList @('launcher/server.js','--port',"$UpstreamPort") -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $runtimeDir 'launcher.out.log') `
        -RedirectStandardError (Join-Path $runtimeDir 'launcher.err.log')

    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if ($launcherProcess.HasExited) { throw 'Launcher failed during integration test.' }
        if (Get-NetTCPConnection -State Listen -LocalPort $UpstreamPort -ErrorAction SilentlyContinue) { break }
        Start-Sleep -Milliseconds 250
    }

    $caddyProcess = Start-Process -FilePath (Resolve-CaddyPath) -ArgumentList @('run','--config','infra/Caddyfile.ip','--adapter','caddyfile') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $runtimeDir 'caddy.out.log') `
        -RedirectStandardError (Join-Path $runtimeDir 'caddy.err.log')

    for ($attempt = 0; $attempt -lt 120; $attempt++) {
        if ($caddyProcess.HasExited) { throw 'Caddy failed during integration test.' }
        if (Get-NetTCPConnection -State Listen -LocalPort 443 -ErrorAction SilentlyContinue) { break }
        Start-Sleep -Milliseconds 250
    }

    $env:TEST_PUBLIC_URL = "https://$PublicAddress"
    $env:TEST_PASSWORD = $testPassword
    node tests/public-stack.integration.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Public stack integration assertions failed.' }

    & npx.cmd playwright test tests/public-access-qa.spec.js --config=playwright.public.config.js
    if ($LASTEXITCODE -ne 0) { throw 'Public access browser QA failed.' }
}
finally {
    if ($caddyProcess -and -not $caddyProcess.HasExited) { Stop-Process -Id $caddyProcess.Id }
    if ($launcherProcess -and -not $launcherProcess.HasExited) { Stop-Process -Id $launcherProcess.Id }
    @(
        'MINIGAME_PASSWORD', 'MINIGAME_COOKIE_SECURE', 'MINIGAME_PUBLIC_URL',
        'MINIGAME_PUBLIC_IP', 'MINIGAME_ACME_CA', 'MINIGAME_UPSTREAM',
        'TEST_PUBLIC_URL', 'TEST_PASSWORD'
    ) | ForEach-Object { Remove-Item "Env:\$_" -ErrorAction SilentlyContinue }
}
