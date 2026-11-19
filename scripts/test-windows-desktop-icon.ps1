# Verify the custom icon in the finished Windows PE, not just the build input PNG.
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$Executable
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path # Root for both desktop CI workflows.
$appExe = (Resolve-Path (Join-Path $repoRoot $Executable)).Path # Built Windows game or Friends executable.
$runtimeIcon = Join-Path $repoRoot 'desktop/dist/win-unpacked/resources/game/assets/hud/icon_hobunji.png' # Image the packaged BrowserWindow loads.
$sourceIcon = Join-Path $repoRoot 'docs/assets/hud/icon_hobunji.png' # Authoritative image for both editions.
$buildIcon = Join-Path $repoRoot 'desktop/build/icon.png' # Resized image converted to ICO by electron-builder.

foreach ($iconPath in @($runtimeIcon, $sourceIcon, $buildIcon)) {
  if (-not (Test-Path -LiteralPath $iconPath -PathType Leaf)) {
    throw "Missing desktop icon: $iconPath"
  }
}
if ((Get-FileHash -LiteralPath $runtimeIcon -Algorithm SHA256).Hash -ne
    (Get-FileHash -LiteralPath $sourceIcon -Algorithm SHA256).Hash) {
  throw 'The packaged BrowserWindow icon differs from the authored game asset.'
}

# Ignore nearly transparent pixels and antialiasing: ICO conversion resizes the 512px PNG.
function Get-IconColorStats([System.Drawing.Bitmap]$bitmap) {
  $pixels = 0 # Opaque pixels that contribute visible icon color.
  $red = 0.0 # Accumulated red channel used to compare the finished icon with its input.
  $green = 0.0 # Accumulated green channel used to compare the finished icon with its input.
  $blue = 0.0 # Accumulated blue channel used to compare the finished icon with its input.
  for ($y = 0; $y -lt $bitmap.Height; $y++) {
    for ($x = 0; $x -lt $bitmap.Width; $x++) {
      $pixel = $bitmap.GetPixel($x, $y) # A single visible ARGB sample.
      if ($pixel.A -lt 96) { continue }
      $pixels++
      $red += $pixel.R
      $green += $pixel.G
      $blue += $pixel.B
    }
  }
  if ($pixels -eq 0) { throw 'Icon has no visible pixels.' }
  return [pscustomobject]@{
    Red = $red / $pixels
    Green = $green / $pixels
    Blue = $blue / $pixels
    Coverage = $pixels / ($bitmap.Width * $bitmap.Height)
  }
}

$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($appExe) # The PE resource shown by Windows, not a configuration value.
if ($null -eq $icon) { throw "The executable has no extractable icon: $appExe" }
$bitmap = $null # Dispose native image resources even on a failed comparison.
$sourceBitmap = $null # RGB source image for a size-independent appearance check.
try {
  $bitmap = $icon.ToBitmap()
  if ($bitmap.Width -lt 16 -or $bitmap.Height -lt 16) {
    throw "Embedded executable icon is unusably small: $appExe"
  }
  $sourceBitmap = [System.Drawing.Bitmap]::new($buildIcon)
  $expected = Get-IconColorStats $sourceBitmap # The intended Hobunji artwork color profile.
  $actual = Get-IconColorStats $bitmap # The icon embedded in the final .exe.
  $distance = [Math]::Sqrt(
    [Math]::Pow($actual.Red - $expected.Red, 2) +
    [Math]::Pow($actual.Green - $expected.Green, 2) +
    [Math]::Pow($actual.Blue - $expected.Blue, 2)
  ) # Robust color check independent of resampling or icon size.
  $coverageDifference = [Math]::Abs($actual.Coverage - $expected.Coverage) # Prevent opaque default-image fallback.
  Write-Host ("Executable icon color distance: {0:N1}; coverage difference: {1:P1}" -f $distance, $coverageDifference)
  if ($distance -gt 65 -or $coverageDifference -gt 0.2) {
    throw "The packaged executable icon does not resemble icon_hobunji.png: $appExe"
  }
} finally {
  if ($null -ne $sourceBitmap) { $sourceBitmap.Dispose() }
  if ($null -ne $bitmap) { $bitmap.Dispose() }
  $icon.Dispose()
}
Write-Host "Verified Hobunji appearance in embedded executable icon and exact runtime PNG: $appExe"
