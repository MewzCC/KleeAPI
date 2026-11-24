[CmdletBinding()]
param([switch]$NoBrowser, [switch]$Dev)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
. (Join-Path $PSScriptRoot 'scripts\resolve-node.ps1')
try { $nodePath = Resolve-KleeNode -Base $PSScriptRoot }
catch { Write-Host $_.Exception.Message; exit 1 }
Write-Host 'Checking KleeAPI and starting local services...'
$managerArgs = @((Join-Path $PSScriptRoot 'scripts\manager.mjs'))
if ($Dev) { $managerArgs += 'dev' } else { $managerArgs += 'start' }
$managerArgs += '--detach'
if ($NoBrowser) { $managerArgs += '--no-browser' }
& $nodePath @managerArgs
exit $LASTEXITCODE
