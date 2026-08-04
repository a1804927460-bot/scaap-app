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
  $minX = $sourceImage.Width
  $minY = $sourceImage.Height
  $maxX = -1
  $maxY = -1

  for ($y = 0; $y -lt $sourceImage.Height; $y += 2) {
    for ($x = 0; $x -lt $sourceImage.Width; $x += 2) {
      $pixel = $sourceImage.GetPixel($x, $y)
      if ($pixel.A -gt 8 -and ($pixel.R -lt 245 -or $pixel.G -lt 245 -or $pixel.B -lt 245)) {
        if ($x -lt $minX) { $minX = $x }
        if ($x -gt $maxX) { $maxX = $x }
        if ($y -lt $minY) { $minY = $y }
        if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }

  if ($maxX -lt $minX -or $maxY -lt $minY) {
    throw 'The source image does not contain a visible non-white mark.'
  }

  $crop = [System.Drawing.Rectangle]::FromLTRB(
    [Math]::Max(0, $minX - 4),
    [Math]::Max(0, $minY - 4),
    [Math]::Min($sourceImage.Width, $maxX + 6),
    [Math]::Min($sourceImage.Height, $maxY + 6)
  )
  $canvasSize = 1024
  $safeInset = 82
  $available = $canvasSize - ($safeInset * 2)
  $scale = [Math]::Min($available / $crop.Width, $available / $crop.Height)
  $drawWidth = [Math]::Round($crop.Width * $scale)
  $drawHeight = [Math]::Round($crop.Height * $scale)
  $drawX = [Math]::Round(($canvasSize - $drawWidth) / 2)
  $drawY = [Math]::Round(($canvasSize - $drawHeight) / 2)

  foreach ($outputPath in $Output) {
    $resolvedOutput = [System.IO.Path]::GetFullPath($outputPath)
    New-Item -ItemType Directory -Path (Split-Path -Parent $resolvedOutput) -Force | Out-Null
    $canvas = New-Object System.Drawing.Bitmap $canvasSize, $canvasSize, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($canvas)
      $attributes = New-Object System.Drawing.Imaging.ImageAttributes
      try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $attributes.SetColorKey(
          [System.Drawing.Color]::FromArgb(245, 245, 245),
          [System.Drawing.Color]::White
        )
        $destination = New-Object System.Drawing.Rectangle $drawX, $drawY, $drawWidth, $drawHeight
        $graphics.DrawImage(
          $sourceImage,
          $destination,
          $crop.X,
          $crop.Y,
          $crop.Width,
          $crop.Height,
          [System.Drawing.GraphicsUnit]::Pixel,
          $attributes
        )
        $canvas.Save($resolvedOutput, [System.Drawing.Imaging.ImageFormat]::Png)
      } finally {
        $attributes.Dispose()
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
