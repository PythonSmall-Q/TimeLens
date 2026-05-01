Param(
  [string]$Version = "0.5.0.0"
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$WindowsDir = Join-Path $RepoRoot "src-tauri\windows"
$ManifestPath = Join-Path $WindowsDir "Package.appxmanifest"
$StagingDir = Join-Path $WindowsDir "msix-staging"
$AssetsDir = Join-Path $StagingDir "Assets"
$OutDir = Join-Path $WindowsDir "out"
$MsixPath = Join-Path $OutDir "TimeLens-$Version.msix"
$SourceIcon = Join-Path $RepoRoot "src-tauri\icons\icon.png"

if (!(Test-Path $ManifestPath)) {
  throw "Package.appxmanifest not found: $ManifestPath"
}

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
$makeAppx = (Get-Command MakeAppx.exe -ErrorAction SilentlyContinue).Source

if (-not $makeAppx) {
  $sdkBinRoot = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
  if (Test-Path $sdkBinRoot) {
    $candidates = Get-ChildItem -Path $sdkBinRoot -Filter MakeAppx.exe -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match "\\x64\\|\\x86\\" } |
      Sort-Object FullName -Descending

    if ($candidates -and $candidates.Count -gt 0) {
      $makeAppx = $candidates[0].FullName
    }
  }
}

if (-not $makeAppx) {
  throw "MakeAppx.exe not found. Install Windows 10/11 SDK and ensure App Certification Kit tools are available."
}

Write-Host "[4/5] Building MSIX package..."
& $makeAppx pack /d $StagingDir /p $MsixPath /o
if ($LASTEXITCODE -ne 0) {
  throw "MakeAppx pack failed with code $LASTEXITCODE"
}

Write-Host "[5/5] Done"
Write-Host "MSIX output: $MsixPath"
Write-Host "Note: sign the package before Store submission."
