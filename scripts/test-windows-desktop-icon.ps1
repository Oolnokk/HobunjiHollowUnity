# Verify the *packaged* PE icon, not just the source PNG used by electron-builder.
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$Executable
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path # Resolves paths identically in both Windows CI workflows.
$appExe = (Resolve-Path (Join-Path $repoRoot $Executable)).Path # Built Windows game or Friends executable.
$stockExe = (Resolve-Path (Join-Path $repoRoot 'desktop/node_modules/electron/dist/electron.exe')).Path # Untouched Electron icon to compare against.
$runtimeIcon = Join-Path $repoRoot 'desktop/dist/win-unpacked/resources/game/assets/hud/icon_hobunji.png' # Image the packaged BrowserWindow loads.
if (-not (Test-Path -LiteralPath $runtimeIcon -PathType Leaf)) {
  throw "The packaged game is missing its BrowserWindow icon: $runtimeIcon"
}

function Get-ExecutableIconHash([string]$path) {
  $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($path) # Reads the icon resource embedded in the actual PE executable.
  if ($null -eq $icon) { throw "Executable contains no extractable icon: $path" }
  try {
    $bitmap = $icon.ToBitmap() # Canonical pixel image for comparison across differently named executables.
    try {
      if ($bitmap.Width -lt 16 -or $bitmap.Height -lt 16) {
        throw "Executable contains an unusably small icon: $path"
      }
      $stream = [System.IO.MemoryStream]::new() # In-memory bitmap serialization prevents test files from entering packaging.
      try {
        $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        return [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($stream.ToArray()))
      } finally {
        $stream.Dispose()
      }
    } finally {
      $bitmap.Dispose()
    }
  } finally {
    $icon.Dispose()
  }
}

$appIconHash = Get-ExecutableIconHash $appExe # What Windows actually sees in the completed executable.
$electronIconHash = Get-ExecutableIconHash $stockExe # Known unwanted fallback icon.
if ($appIconHash -eq $electronIconHash) {
  throw "Packaged executable still uses Electron's default icon: $appExe"
}

Write-Host "Verified custom embedded executable icon and bundled runtime PNG: $appExe"
