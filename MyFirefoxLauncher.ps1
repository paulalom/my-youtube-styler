param(
  [string] $FirefoxPath = $env:MY_YOUTUBE_STYLER_FIREFOX,
  [string] $ProfilePath = $env:MY_YOUTUBE_STYLER_FIREFOX_PROFILE,
  [string] $StartUrl = $env:MY_YOUTUBE_STYLER_START_URL,
  [switch] $UseTemporaryProfile,
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
  $localCommand = Join-Path $RepoRoot "node_modules\web-ext\lib\firefox\remote.js"

  if (Test-Path -LiteralPath $localCommand -PathType Leaf) {
    return $localCommand
  }

  return $null
}

function Resolve-NodeExecutable {
  $node = Get-Command "node.exe" -ErrorAction SilentlyContinue
  if (-not $node) {
    $node = Get-Command "node" -ErrorAction SilentlyContinue
  }

  if (-not $node) {
    throw "Node.js was not found. Install Node.js, then run npm install in this repo."
  }

  return $node.Source
}

function Read-IniSections([string] $Path) {
  $sections = @()
  $current = $null

  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()

    if (-not $trimmed -or $trimmed.StartsWith(";") -or $trimmed.StartsWith("#")) {
      continue
    }

    if ($trimmed -match '^\[(.+)\]$') {
      $current = [ordered] @{ Section = $matches[1] }
      $sections += $current
      continue
    }

    if ($current -and $trimmed -match '^([^=]+)=(.*)$') {
      $current[$matches[1].Trim()] = $matches[2].Trim()
    }
  }

  return $sections
}

function Resolve-FirefoxProfilePath([string] $FirefoxDataRoot, [string] $ProfilePathValue, [bool] $IsRelative) {
  if (-not $ProfilePathValue) {
    return $null
  }

  if ([System.IO.Path]::IsPathRooted($ProfilePathValue) -or -not $IsRelative) {
    return Get-FullPath $ProfilePathValue
  }

  return Get-FullPath (Join-Path $FirefoxDataRoot $ProfilePathValue)
}

function Get-FirefoxDefaultProfilePath {
  $firefoxDataRoot = Join-Path $env:APPDATA "Mozilla\Firefox"
  $installsPath = Join-Path $firefoxDataRoot "installs.ini"
  $profilesPath = Join-Path $firefoxDataRoot "profiles.ini"

  if (Test-Path -LiteralPath $installsPath -PathType Leaf) {
    foreach ($section in Read-IniSections $installsPath) {
      if ($section.Contains("Default")) {
        $candidate = Resolve-FirefoxProfilePath $firefoxDataRoot $section["Default"] $true

        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Container)) {
          return $candidate
        }
      }
    }
  }

  if (-not (Test-Path -LiteralPath $profilesPath -PathType Leaf)) {
    throw "Could not find Firefox profiles.ini at $profilesPath."
  }

  $profileSections = @(
    Read-IniSections $profilesPath |
      Where-Object { $_.Section -like "Profile*" -and $_.Contains("Path") }
  )

  foreach ($section in Read-IniSections $profilesPath) {
    if ($section.Section -like "Install*" -and $section.Contains("Default")) {
      $candidate = Resolve-FirefoxProfilePath $firefoxDataRoot $section["Default"] $true

      if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Container)) {
        return $candidate
      }
    }
  }

  $defaultSection = $profileSections | Where-Object { $_.Contains("Default") -and $_["Default"] -eq "1" } | Select-Object -First 1
  if ($defaultSection) {
    $candidate = Resolve-FirefoxProfilePath $firefoxDataRoot $defaultSection["Path"] ($defaultSection["IsRelative"] -ne "0")

    if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Container)) {
      return $candidate
    }
  }

  $defaultReleaseSection = $profileSections | Where-Object { $_.Contains("Name") -and $_["Name"] -eq "default-release" } | Select-Object -First 1
  if ($defaultReleaseSection) {
    $candidate = Resolve-FirefoxProfilePath $firefoxDataRoot $defaultReleaseSection["Path"] ($defaultReleaseSection["IsRelative"] -ne "0")

    if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Container)) {
      return $candidate
    }
  }

  throw "Could not determine Firefox's default profile from $profilesPath."
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
$launcherScript = Join-Path $repoRoot "scripts\launch-firefox.mjs"

if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw "Could not find extension manifest at $manifestPath."
}

if (-not (Test-Path -LiteralPath $launcherScript -PathType Leaf)) {
  throw "Could not find launcher helper at $launcherScript."
}

if ($UseTemporaryProfile -and ($UsePersistentLauncherProfile -or $ProfilePath)) {
  throw "UseTemporaryProfile cannot be combined with UsePersistentLauncherProfile or ProfilePath."
}

$useCustomProfile = -not $UseTemporaryProfile
$shouldCreateProfile = $false
$profileModeLabel = "Firefox default profile"

if ($ProfilePath) {
  $profileModeLabel = "custom launcher profile"
  $shouldCreateProfile = $true
} elseif ($UsePersistentLauncherProfile) {
  $profileModeLabel = "dedicated launcher profile"
  $ProfilePath = Join-Path $env:LOCALAPPDATA "MyYouTubeStyler\FirefoxLauncherProfile"
  $shouldCreateProfile = $true
}

$profilePathFull = $null

if ($useCustomProfile) {
  if ($ProfilePath) {
    $profilePathFull = Get-FullPath $ProfilePath
  } else {
    $profilePathFull = Get-FirefoxDefaultProfilePath
  }

  $defaultProfilesRoot = Get-FullPath (Join-Path $env:APPDATA "Mozilla\Firefox\Profiles")

  if (
    $profilePathFull.StartsWith($defaultProfilesRoot, [System.StringComparison]::OrdinalIgnoreCase) -and
    $profileModeLabel -ne "Firefox default profile" -and
    -not $AllowFirefoxProfilePreferenceChanges
  ) {
    throw @"
Refusing to run against a normal Firefox profile:
$profilePathFull

web-ext needs --keep-profile-changes for this launcher profile, and that changes Firefox prefs used for extension debugging.
Use the normal default profile, choose a profile outside Firefox's profile directory, or pass -AllowFirefoxProfilePreferenceChanges if you really intend this.
"@
  }

  if (-not $DryRun -and $shouldCreateProfile -and -not (Test-Path -LiteralPath $profilePathFull -PathType Container)) {
    New-Item -ItemType Directory -Path $profilePathFull -Force | Out-Null
  } elseif (-not (Test-Path -LiteralPath $profilePathFull -PathType Container)) {
    throw "Firefox profile directory was not found: $profilePathFull"
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
  throw "Local web-ext dependency files were not found after installing dependencies."
}

$nodeExecutable = Resolve-NodeExecutable
$firefoxExecutable = Resolve-FirefoxExecutable $FirefoxPath

$launcherArgs = @(
  $launcherScript,
  "--extension",
  $extensionDir
)

if ($useCustomProfile) {
  $launcherArgs += @("--profile", $profilePathFull)
} else {
  $launcherArgs += "--temporary-profile"
}

if ($firefoxExecutable) {
  $launcherArgs += @("--firefox", $firefoxExecutable)
}

if ($StartUrl) {
  $launcherArgs += @("--start-url", $StartUrl)
}

if ($DryRun) {
  $launcherArgs += "--dry-run"
}

Write-Host "Launching Firefox with My YouTube Styler attached..."
Write-Host "Extension: $extensionDir"
if ($useCustomProfile) {
  Write-Host "Profile mode: $profileModeLabel"
  Write-Host "Profile: $profilePathFull"
} else {
  Write-Host "Profile mode: web-ext temporary profile"
}
if ($firefoxExecutable) {
  Write-Host "Firefox: $firefoxExecutable"
} else {
  Write-Host "Firefox: default Firefox detected by launcher helper"
}

& $nodeExecutable @launcherArgs
exit $LASTEXITCODE
