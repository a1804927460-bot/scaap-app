param(
  [Parameter(Mandatory = $true)]
  [string]$Source,

  [Parameter(Mandatory = $true)]
  [string[]]$Output
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$sourceImage = [System.Drawing.Bitmap]::FromFile((Resolve-Path -LiteralPath $Source))
try {
  $canvasSize = 1024
  $scale = [Math]::Min($canvasSize / $sourceImage.Width, $canvasSize / $sourceImage.Height)
  $drawWidth = [Math]::Round($sourceImage.Width * $scale)
  $drawHeight = [Math]::Round($sourceImage.Height * $scale)
  $drawX = [Math]::Round(($canvasSize - $drawWidth) / 2)
  $drawY = [Math]::Round(($canvasSize - $drawHeight) / 2)

  foreach ($outputPath in $Output) {
    $resolvedOutput = [System.IO.Path]::GetFullPath($outputPath)
    New-Item -ItemType Directory -Path (Split-Path -Parent $resolvedOutput) -Force | Out-Null
    $canvas = New-Object System.Drawing.Bitmap $canvasSize, $canvasSize, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($canvas)
      try {
        $graphics.Clear([System.Drawing.Color]::White)
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $destination = New-Object System.Drawing.Rectangle $drawX, $drawY, $drawWidth, $drawHeight
        $graphics.DrawImage($sourceImage, $destination)
        $canvas.Save($resolvedOutput, [System.Drawing.Imaging.ImageFormat]::Png)
      } finally {
        $graphics.Dispose()
      }
    } finally {
      $canvas.Dispose()
    }
    Write-Output $resolvedOutput
  }
} finally {
  $sourceImage.Dispose()
}
