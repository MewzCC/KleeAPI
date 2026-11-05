[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$nodePath = Join-Path $PSScriptRoot 'runtime\node.exe'
if (-not (Test-Path -LiteralPath $nodePath)) {
    $nodePath = (Get-Command node -ErrorAction Stop).Source
}
& $nodePath (Join-Path $PSScriptRoot 'scripts\manager.mjs') stop
exit $LASTEXITCODE
