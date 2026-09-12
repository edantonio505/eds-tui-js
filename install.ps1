# eds-tui installer for Windows. See install.sh for Linux/macOS and for
# why this clone+pack+install approach is used instead of a plain
# `npm install -g eds-tui` or `npm install -g git+https://...` — both are
# currently unreliable for this package (stale npm registry publish, and a
# confirmed-flaky npm git-dependency fetch for this repo, respectively).
#
# Quick install (run in PowerShell):
#   irm https://raw.githubusercontent.com/edantonio505/eds-tui-js/main/install.ps1 | iex

$ErrorActionPreference = "Stop"
$RepoUrl = "https://github.com/edantonio505/eds-tui-js.git"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js >=20 is required. Install it first: https://nodejs.org"
    exit 1
}
$NodeMajor = [int]((node -e "console.log(process.versions.node.split('.')[0])") 2>$null)
if ($NodeMajor -lt 20) {
    Write-Error "Node.js >=20 is required (found $(node -v)). Install a newer version: https://nodejs.org"
    exit 1
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Error "git is required to install eds-tui reliably right now. Install it first."
    exit 1
}

$Tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("eds-tui-install-" + [System.Guid]::NewGuid())
try {
    Write-Host "Cloning eds-tui-js..."
    git clone --depth 1 -q $RepoUrl $Tmp
    if ($LASTEXITCODE -ne 0) { throw "git clone failed" }

    Write-Host "Packing..."
    Push-Location $Tmp
    $Tarball = (npm pack --silent 2>$null | Select-Object -Last 1)
    Pop-Location
    $TarballPath = Join-Path $Tmp $Tarball
    if (-not $Tarball -or -not (Test-Path $TarballPath)) {
        throw "npm pack did not produce a tarball"
    }

    Write-Host "Installing the ask CLI..."
    npm install -g $TarballPath
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

    Write-Host ""
    Write-Host "Done -- run 'ask' from any shell."
} finally {
    Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
}
