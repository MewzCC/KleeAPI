[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$nodePath = Join-Path $PSScriptRoot 'runtime\node.exe'
if (-not (Test-Path -LiteralPath $nodePath)) {
    $systemNode = Get-Command node -ErrorAction SilentlyContinue
    if (-not $systemNode) {
        Write-Host 'Node.js was not found. Fully extract the portable ZIP; runtime\node.exe must be present.'
        exit 1
    }
    $nodePath = $systemNode.Source
}
& $nodePath (Join-Path $PSScriptRoot 'scripts\manager.mjs') stop
exit $LASTEXITCODE
