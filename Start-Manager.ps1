[CmdletBinding()]
param([switch]$NoBrowser, [switch]$Dev)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$nodePath = Join-Path $PSScriptRoot 'runtime\node.exe'
if (-not (Test-Path -LiteralPath $nodePath)) {
    $nodePath = (Get-Command node -ErrorAction Stop).Source
}
$managerArgs = @((Join-Path $PSScriptRoot 'scripts\manager.mjs'))
if ($Dev) { $managerArgs += 'dev' } else { $managerArgs += 'start' }
$managerArgs += '--detach'
if ($NoBrowser) { $managerArgs += '--no-browser' }
& $nodePath @managerArgs
exit $LASTEXITCODE
