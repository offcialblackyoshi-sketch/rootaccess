# Generates the app icons in ../icons. Run from PowerShell:
#   powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot '..\icons'
New-Item -ItemType Directory -Force $outDir | Out-Null

function Color($hex) { [System.Drawing.ColorTranslator]::FromHtml($hex) }

function RoundRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

function Make-Icon([int]$size, [string]$name, [bool]$maskable) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $g.Clear([System.Drawing.Color]::Transparent)

    # Everything below is drawn on a 512x512 grid.
    $g.ScaleTransform([float]($size / 512), [float]($size / 512))

    $bg = New-Object System.Drawing.SolidBrush (Color '#050a06')
    $green = Color '#33ff66'
    if ($maskable) {
        $g.FillRectangle($bg, 0, 0, 512, 512)
    } else {
        $g.FillPath($bg, (RoundRect 16 16 480 480 96))
        $pen = New-Object System.Drawing.Pen $green, 10
        $g.DrawPath($pen, (RoundRect 21 21 470 470 92))
    }

    # Scanlines
    $scan = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(28, 51, 255, 102))
    for ($y = 40; $y -lt 472; $y += 12) { $g.FillRectangle($scan, 40, $y, 432, 4) }

    # ">" chevron
    $pen = New-Object System.Drawing.Pen $green, 44
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $chev = [System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF 140, 170),
        (New-Object System.Drawing.PointF 240, 256),
        (New-Object System.Drawing.PointF 140, 342))
    $g.DrawLines($pen, $chev)

    # "_" cursor
    $g.FillRectangle((New-Object System.Drawing.SolidBrush $green), 270, 316, 110, 40)

    $path = Join-Path $outDir $name
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    Write-Output "Wrote $path"
}

Make-Icon 192 'icon-192.png' $false
Make-Icon 512 'icon-512.png' $false
Make-Icon 512 'maskable-512.png' $true
