Param(
  [string]$Version,
  [string]$MakeAppxPath
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$PackageJsonPath = Join-Path $RepoRoot "package.json"
$PackageJson = Get-Content $PackageJsonPath -Raw | ConvertFrom-Json
$TauriConfigPath = Join-Path $RepoRoot "src-tauri\tauri.conf.json"
$TauriConfig = Get-Content $TauriConfigPath -Raw | ConvertFrom-Json

function Get-MsixVersion {
  param([string]$InputVersion)

  $v = $InputVersion.Trim()
  if ($v -match '^\d+\.\d+\.\d+$') {
    return "$v.0"
  }
  if ($v -match '^\d+\.\d+\.\d+\.\d+$') {
    return $v
  }

  throw "Invalid MSIX version '$InputVersion'. Use x.y.z or x.y.z.w."
}

function Convert-ToAppxIdentityName {
  param([string]$Raw)

  $name = ($Raw -replace '[^A-Za-z0-9\.]', '.')
  $name = ($name -replace '\.+', '.').Trim('.')
  if ([string]::IsNullOrWhiteSpace($name)) {
    return "TimeLens.App"
  }
  return $name
}

function New-AppxManifest {
  param(
    [string]$Path,
    [string]$IdentityName,
    [string]$IdentityPublisher,
    [string]$IdentityVersion,
    [string]$DisplayName,
    [string]$Description,
    [string]$PublisherDisplayName
  )

  $manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap rescap">
  <Identity Name="$IdentityName" Publisher="$IdentityPublisher" Version="$IdentityVersion" />
  <Properties>
    <DisplayName>$DisplayName</DisplayName>
    <PublisherDisplayName>$PublisherDisplayName</PublisherDisplayName>
    <Description>$Description</Description>
    <Logo>Assets\StoreLogo.png</Logo>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Universal" MinVersion="10.0.17763.0" MaxVersionTested="10.0.22621.0" />
  </Dependencies>
  <Resources>
    <Resource Language="en-us" />
    <Resource Language="zh-cn" />
  </Resources>
  <Applications>
    <Application Id="App" Executable="timelens.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="$DisplayName"
        Description="$Description"
        BackgroundColor="transparent"
        Square44x44Logo="Assets\Square44x44Logo.png"
        Square150x150Logo="Assets\Square150x150Logo.png">
        <uap:DefaultTile
          Wide310x150Logo="Assets\Wide310x150Logo.png"
          Square310x310Logo="Assets\Square310x310Logo.png"
          Square71x71Logo="Assets\Square71x71Logo.png" />
      </uap:VisualElements>
    </Application>
  </Applications>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
"@

  Set-Content -Path $Path -Value $manifest -Encoding UTF8
}

function Resolve-MakeAppxPath {
  param([string]$OverridePath)

  $checked = New-Object System.Collections.Generic.List[string]

  if (-not [string]::IsNullOrWhiteSpace($OverridePath)) {
    $overrideResolved = [Environment]::ExpandEnvironmentVariables($OverridePath)
    $checked.Add($overrideResolved)
    if (Test-Path $overrideResolved) {
      return @($overrideResolved, $checked)
    }
  }

  $cmd = Get-Command MakeAppx.exe -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) {
    $checked.Add($cmd.Source)
    return @($cmd.Source, $checked)
  }

  $roots = @(
    "${env:ProgramFiles(x86)}\Windows Kits\10",
      "${env:ProgramFiles}\Windows Kits\10",
      "D:\\Program Files (x86)\\Windows Kits\\10",
    "D:\\Program Files\\Windows Kits\\10",
    "D:\\Windows Kits\\10",
    "C:\\Windows Kits\\10"
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and (Test-Path $_) }

  foreach ($root in $roots) {
    $directCandidates = @(
      (Join-Path $root "App Certification Kit\MakeAppx.exe"),
      (Join-Path $root "bin\x64\MakeAppx.exe"),
      (Join-Path $root "bin\x86\MakeAppx.exe"),
      (Join-Path $root "bin\arm64\MakeAppx.exe")
    )
    foreach ($candidate in $directCandidates) {
      $checked.Add($candidate)
      if (Test-Path $candidate) {
        return @($candidate, $checked)
      }
    }

    $binRoot = Join-Path $root "bin"
    if (Test-Path $binRoot) {
      $versioned = Get-ChildItem -Path $binRoot -Directory -ErrorAction SilentlyContinue
      foreach ($dir in ($versioned | Sort-Object Name -Descending)) {
        foreach ($arch in @("x64", "x86", "arm64")) {
          $candidate = Join-Path $dir.FullName "$arch\MakeAppx.exe"
          $checked.Add($candidate)
          if (Test-Path $candidate) {
            return @($candidate, $checked)
          }
        }
      }
    }
  }

  return @($null, $checked)
}

if (-not $Version) {
  $Version = $PackageJson.version
}

$Version = Get-MsixVersion -InputVersion $Version

$WindowsDir = Join-Path $RepoRoot "src-tauri\windows"
$ManifestPath = Join-Path $WindowsDir "Package.appxmanifest"
$StagingDir = Join-Path $WindowsDir "msix-staging"
$AssetsDir = Join-Path $StagingDir "Assets"
$OutDir = Join-Path $WindowsDir "out"
$MsixPath = Join-Path $OutDir "TimeLens-$Version.msix"
$SourceIcon = Join-Path $RepoRoot "src-tauri\icons\icon.png"

$identityName = Convert-ToAppxIdentityName -Raw $TauriConfig.identifier
$publisher = $TauriConfig.bundle.publisher
if ([string]::IsNullOrWhiteSpace($publisher)) {
  $publisher = "CN=TimeLens"
}
$displayName = if ([string]::IsNullOrWhiteSpace($TauriConfig.productName)) { "TimeLens" } else { $TauriConfig.productName }
$publisherDisplayName = if ($PackageJson.authors -and $PackageJson.authors.Count -gt 0) {
  [string]$PackageJson.authors[0]
} else {
  $displayName
}
$description = if ([string]::IsNullOrWhiteSpace($PackageJson.description)) {
  "Screen time tracker and desktop widget manager"
} else {
  $PackageJson.description
}
Write-Host "Regenerating Package.appxmanifest..."
New-AppxManifest -Path $ManifestPath -IdentityName $identityName -IdentityPublisher $publisher -IdentityVersion $Version -DisplayName $displayName -Description $description -PublisherDisplayName $publisherDisplayName
Write-Host "Generated manifest: $ManifestPath"

Write-Host "[1/5] Building Tauri release binary..."
Push-Location $RepoRoot
$TauriCli = Join-Path $RepoRoot "node_modules\.bin\tauri.cmd"
if (!(Test-Path $TauriCli)) {
  throw "Tauri CLI not found: $TauriCli. Run 'npm install' first."
}
& $TauriCli build --no-bundle
if ($LASTEXITCODE -ne 0) {
  throw "Tauri build failed with exit code $LASTEXITCODE"
}
Pop-Location

$ExePath = Join-Path $RepoRoot "src-tauri\target\release\timelens.exe"
if (!(Test-Path $ExePath)) {
  $ReleaseDir = Join-Path $RepoRoot "src-tauri\target\release"
  if (Test-Path $ReleaseDir) {
    $CandidateExe = Get-ChildItem -Path $ReleaseDir -Filter "*.exe" -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -notlike "*-*" } |
      Select-Object -First 1
    if ($CandidateExe) {
      $ExePath = $CandidateExe.FullName
    }
  }
}
if (!(Test-Path $ExePath)) {
  throw "Built exe not found: $ExePath"
}

Write-Host "[2/5] Preparing staging directory..."
if (Test-Path $StagingDir) { Remove-Item -Recurse -Force $StagingDir }
New-Item -ItemType Directory -Path $StagingDir | Out-Null
New-Item -ItemType Directory -Path $AssetsDir -Force | Out-Null
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

Copy-Item $ExePath (Join-Path $StagingDir "timelens.exe") -Force
Copy-Item $ManifestPath (Join-Path $StagingDir "AppxManifest.xml") -Force

if (!(Test-Path $SourceIcon)) {
  throw "Source icon not found: $SourceIcon"
}

Write-Host "[2.5/5] Generating MSIX logo assets from src-tauri/icons/icon.png..."
Add-Type -AssemblyName System.Drawing

$assetMap = @(
  @{ Name = "StoreLogo.png"; Width = 50; Height = 50 },
  @{ Name = "Square44x44Logo.png"; Width = 44; Height = 44 },
  @{ Name = "Square71x71Logo.png"; Width = 71; Height = 71 },
  @{ Name = "Square150x150Logo.png"; Width = 150; Height = 150 },
  @{ Name = "Wide310x150Logo.png"; Width = 310; Height = 150 },
  @{ Name = "Square310x310Logo.png"; Width = 310; Height = 310 }
)

$srcImg = [System.Drawing.Image]::FromFile($SourceIcon)
try {
  foreach ($asset in $assetMap) {
    $bmp = New-Object System.Drawing.Bitmap($asset.Width, $asset.Height)
    try {
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      try {
        $g.Clear([System.Drawing.Color]::Transparent)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $g.DrawImage($srcImg, 0, 0, $asset.Width, $asset.Height)
      }
      finally {
        $g.Dispose()
      }

      $outPath = Join-Path $AssetsDir $asset.Name
      $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
      $bmp.Dispose()
    }
  }
}
finally {
  $srcImg.Dispose()
}

Write-Host "[3/5] Resolving MakeAppx.exe..."
$resolved = Resolve-MakeAppxPath -OverridePath $MakeAppxPath
$makeAppx = $resolved[0]
$checkedPaths = $resolved[1]

if (-not $makeAppx) {
  Write-Host "Checked locations for MakeAppx.exe:"
  $checkedPaths | Select-Object -Unique | ForEach-Object { Write-Host " - $_" }
  throw "MakeAppx.exe not found. Install Windows 10/11 SDK components that include MSIX/App Certification Kit tools, or pass -MakeAppxPath with the full executable path."
}

Write-Host "Using MakeAppx: $makeAppx"

Write-Host "[4/5] Building MSIX package..."
& $makeAppx pack /d $StagingDir /p $MsixPath /o
if ($LASTEXITCODE -ne 0) {
  throw "MakeAppx pack failed with code $LASTEXITCODE"
}

Write-Host "[5/5] Done"
Write-Host "MSIX output: $MsixPath"
Write-Host "Note: sign the package before Store submission."
