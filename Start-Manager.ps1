[CmdletBinding()]
param([switch]$NoBrowser, [switch]$Dev)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$nodePath = Join-Path $PSScriptRoot 'runtime\node.exe'
if (-not (Test-Path -LiteralPath $nodePath)) {
    $systemNode = Get-Command node -ErrorAction SilentlyContinue
    if (-not $systemNode) {
        Write-Host 'Node.js was not found. Fully extract the portable ZIP before starting; runtime\node.exe must be present.'
        Write-Host 'For source builds, install Node.js 22.12+ first. See docs\TUTORIAL.md.'
        exit 1
    }
    $nodePath = $systemNode.Source
}
Write-Host 'Checking KleeAPI and starting local services...'
$managerArgs = @((Join-Path $PSScriptRoot 'scripts\manager.mjs'))
if ($Dev) { $managerArgs += 'dev' } else { $managerArgs += 'start' }
$managerArgs += '--detach'
if ($NoBrowser) { $managerArgs += '--no-browser' }
& $nodePath @managerArgs
exit $LASTEXITCODE
