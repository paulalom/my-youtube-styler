param(
  [string] $FirefoxPath = $env:MY_YOUTUBE_STYLER_FIREFOX,
  [string] $ProfilePath = $env:MY_YOUTUBE_STYLER_FIREFOX_PROFILE,
  [string] $StartUrl = "https://www.youtube.com/",
  [switch] $UsePersistentLauncherProfile,
  [switch] $AllowFirefoxProfilePreferenceChanges,
  [switch] $SkipDependencyInstall,
  [switch] $DryRun
)

$ErrorActionPreference = "Stop"

function Get-FullPath([string] $Path) {
  return [System.IO.Path]::GetFullPath($Path)
}

function Resolve-FirefoxExecutable([string] $PreferredPath) {
  if ($PreferredPath) {
    if (Test-Path -LiteralPath $PreferredPath -PathType Leaf) {
      return Get-FullPath $PreferredPath
    }

    return $PreferredPath
  }

  $candidates = @(
    (Join-Path ${env:ProgramFiles} "Mozilla Firefox\firefox.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Mozilla Firefox\firefox.exe")
  )

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      return Get-FullPath $candidate
    }
  }

  $command = Get-Command "firefox.exe" -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  return $null
}

function Get-LocalWebExtCommand([string] $RepoRoot) {
  $localCommand = Join-Path $RepoRoot "node_modules\.bin\web-ext.cmd"

  if (Test-Path -LiteralPath $localCommand -PathType Leaf) {
    return $localCommand
  }

  return $null
}

function Install-NodeDependencies([string] $RepoRoot) {
  $npm = Get-Command "npm.cmd" -ErrorAction SilentlyContinue
  if (-not $npm) {
    $npm = Get-Command "npm" -ErrorAction SilentlyContinue
  }

  if (-not $npm) {
    throw "Node.js/npm was not found. Install Node.js, then run npm install in this repo."
  }

  Write-Host "Installing launcher dependency web-ext into local node_modules..."
  Push-Location $RepoRoot
  try {
    & $npm.Source install
    if ($LASTEXITCODE -ne 0) {
      throw "npm install failed with exit code $LASTEXITCODE."
    }
  } finally {
    Pop-Location
  }
}

$repoRoot = Split-Path -Parent $PSCommandPath
$extensionDir = Join-Path $repoRoot "extension"
$manifestPath = Join-Path $extensionDir "manifest.json"

if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw "Could not find extension manifest at $manifestPath."
}

$useCustomProfile = $UsePersistentLauncherProfile -or [bool] $ProfilePath

if ($UsePersistentLauncherProfile -and -not $ProfilePath) {
  $ProfilePath = Join-Path $env:LOCALAPPDATA "MyYouTubeStyler\FirefoxLauncherProfile"
}

$profilePathFull = $null

if ($useCustomProfile) {
  $profilePathFull = Get-FullPath $ProfilePath
  $defaultProfilesRoot = Get-FullPath (Join-Path $env:APPDATA "Mozilla\Firefox\Profiles")

  if (
    $profilePathFull.StartsWith($defaultProfilesRoot, [System.StringComparison]::OrdinalIgnoreCase) -and
    -not $AllowFirefoxProfilePreferenceChanges
  ) {
    throw @"
Refusing to run against a normal Firefox profile:
$profilePathFull

web-ext needs --keep-profile-changes for this launcher profile, and that changes Firefox prefs used for extension debugging.
Use the default dedicated launcher profile, or pass -AllowFirefoxProfilePreferenceChanges if you really intend this.
"@
  }

  if (-not $DryRun -and -not (Test-Path -LiteralPath $profilePathFull -PathType Container)) {
    New-Item -ItemType Directory -Path $profilePathFull -Force | Out-Null
  }
}

$webExtCommand = Get-LocalWebExtCommand $repoRoot
if (-not $webExtCommand) {
  if ($SkipDependencyInstall) {
    throw "Local web-ext was not found. Run npm install in this repo, or omit -SkipDependencyInstall."
  }

  Install-NodeDependencies $repoRoot
  $webExtCommand = Get-LocalWebExtCommand $repoRoot
}

if (-not $webExtCommand) {
  throw "Local web-ext command was not found after installing dependencies."
}

$firefoxExecutable = Resolve-FirefoxExecutable $FirefoxPath

$webExtArgs = @(
  "run",
  "--source-dir=$extensionDir",
  "--target=firefox-desktop",
  "--no-reload",
  "--start-url=$StartUrl"
)

if ($useCustomProfile) {
  $webExtArgs += @(
    "--firefox-profile=$profilePathFull",
    "--profile-create-if-missing",
    "--keep-profile-changes"
  )
}

if ($firefoxExecutable) {
  $webExtArgs += "--firefox=$firefoxExecutable"
}

Write-Host "Launching Firefox with My YouTube Styler attached..."
Write-Host "Extension: $extensionDir"
if ($useCustomProfile) {
  Write-Host "Launcher profile: $profilePathFull"
} else {
  Write-Host "Launcher profile: web-ext temporary profile"
}
if ($firefoxExecutable) {
  Write-Host "Firefox: $firefoxExecutable"
} else {
  Write-Host "Firefox: default Firefox detected by web-ext"
}

if ($DryRun) {
  Write-Host "Dry run only. Firefox was not launched."
  Write-Host "Command: $webExtCommand"
  Write-Host "Arguments:"
  $webExtArgs | ForEach-Object { Write-Host "  $_" }
  exit 0
}

& $webExtCommand @webExtArgs
exit $LASTEXITCODE
