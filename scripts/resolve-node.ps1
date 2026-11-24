function Resolve-KleeNode {
    param([string]$Base)
    $candidates = @((Join-Path $Base 'runtime\node.exe'))
    $candidates += @(Get-Command node -CommandType Application -All -ErrorAction SilentlyContinue | ForEach-Object { $_.Source })
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
        try {
            $version = & $candidate --version 2>$null
            if ($LASTEXITCODE -eq 0 -and "$version" -match '^v(\d+)\.(\d+)\.\d+$') {
                $major = [int]$Matches[1]
                $minor = [int]$Matches[2]
                if ($major -gt 22 -or ($major -eq 22 -and $minor -ge 12)) { return $candidate }
            }
        } catch { continue }
    }
    throw 'No working Node.js 22.12+ was found. Install Node.js with npm: https://nodejs.org/ or download and fully extract the portable ZIP: https://github.com/MewzCC/KleeAPI/releases'
}
