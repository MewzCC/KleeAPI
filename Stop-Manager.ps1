[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
. (Join-Path $PSScriptRoot 'scripts\resolve-node.ps1')
try { $nodePath = Resolve-KleeNode -Base $PSScriptRoot }
catch { Write-Host $_.Exception.Message; exit 1 }
& $nodePath (Join-Path $PSScriptRoot 'scripts\manager.mjs') stop
exit $LASTEXITCODE
