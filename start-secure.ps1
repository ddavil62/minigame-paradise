$ErrorActionPreference = 'Stop'

$securePassword = Read-Host '미니게임 천국 접속 비밀번호' -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)

try {
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    if ([string]::IsNullOrWhiteSpace($plainPassword)) {
        throw '비밀번호는 비워둘 수 없습니다.'
    }

    $env:MINIGAME_PASSWORD = $plainPassword
    npm start
}
finally {
    Remove-Item Env:\MINIGAME_PASSWORD -ErrorAction SilentlyContinue
    $plainPassword = $null
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
}

