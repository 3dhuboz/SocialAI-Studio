param(
  [string]$Output = "shopify-app/public/socialai-studio-reviewer-screencast.mp4"
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$outPath = Join-Path $root $Output
$tempDir = Join-Path $env:TEMP ("socialai-shopify-screencast-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

$script:W = 1600
$script:H = 900

function Brush([string]$hex) {
  return New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($hex))
}

function PenC([string]$hex, [float]$width = 1) {
  return New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml($hex), $width)
}

function FontC([float]$size, [System.Drawing.FontStyle]$style = [System.Drawing.FontStyle]::Regular) {
  return New-Object System.Drawing.Font("Segoe UI", $size, $style, [System.Drawing.GraphicsUnit]::Pixel)
}

function Draw-RoundedRect($g, [int]$x, [int]$y, [int]$w, [int]$h, [int]$r, $brush, $pen = $null) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  if ($brush) { $g.FillPath($brush, $path) }
  if ($pen) { $g.DrawPath($pen, $path) }
  $path.Dispose()
}

function Draw-Text($g, [string]$text, [int]$x, [int]$y, [int]$w, [int]$h, [float]$size, [string]$color = "#17212b", [System.Drawing.FontStyle]$style = [System.Drawing.FontStyle]::Regular) {
  $font = FontC $size $style
  $brush = Brush $color
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Trimming = [System.Drawing.StringTrimming]::Word
  $fmt.FormatFlags = 0
  $g.DrawString($text, $font, $brush, (New-Object System.Drawing.RectangleF($x, $y, $w, $h)), $fmt)
  $fmt.Dispose(); $brush.Dispose(); $font.Dispose()
}

function Draw-Badge($g, [string]$text, [int]$x, [int]$y, [string]$bg = "#e8f7ee", [string]$fg = "#157347") {
  Draw-RoundedRect $g $x $y 168 36 12 (Brush $bg)
  Draw-Text $g $text ($x + 18) ($y + 8) 140 24 18 $fg ([System.Drawing.FontStyle]::Bold)
}

function Draw-Button($g, [string]$text, [int]$x, [int]$y, [int]$w = 190, [string]$bg = "#008060") {
  Draw-RoundedRect $g $x $y $w 46 8 (Brush $bg)
  Draw-Text $g $text ($x + 18) ($y + 11) ($w - 36) 26 18 "#ffffff" ([System.Drawing.FontStyle]::Bold)
}

function Draw-Shell($g, [string]$title, [string]$subtitle) {
  $g.Clear([System.Drawing.ColorTranslator]::FromHtml("#f6f6f7"))
  $g.FillRectangle((Brush "#101820"), 0, 0, $script:W, 72)
  Draw-Text $g "SocialAI Studio" 44 19 300 34 26 "#ffffff" ([System.Drawing.FontStyle]::Bold)
  Draw-Text $g "Shopify App Review demo" 1250 24 300 28 20 "#dce7ea"
  $g.FillRectangle((Brush "#ffffff"), 0, 72, 258, ($script:H - 72))
  foreach ($item in @("Home", "Products", "Compose", "Calendar", "Autopilot", "Settings", "Insights")) {
    $i = [array]::IndexOf(@("Home", "Products", "Compose", "Calendar", "Autopilot", "Settings", "Insights"), $item)
    $y = 112 + ($i * 56)
    $bg = if ($title -like "$item*") { "#e7f5f1" } else { "#ffffff" }
    Draw-RoundedRect $g 24 $y 210 42 8 (Brush $bg)
    Draw-Text $g $item 48 ($y + 10) 160 25 19 "#17212b"
  }
  Draw-Text $g $title 304 106 720 48 36 "#17212b" ([System.Drawing.FontStyle]::Bold)
  Draw-Text $g $subtitle 306 154 1000 42 22 "#616a75"
}

function Draw-Card($g, [int]$x, [int]$y, [int]$w, [int]$h, [string]$title = "") {
  Draw-RoundedRect $g $x $y $w $h 12 (Brush "#ffffff") (PenC "#d8dee4" 1.4)
  if ($title) { Draw-Text $g $title ($x + 24) ($y + 22) ($w - 48) 32 24 "#17212b" ([System.Drawing.FontStyle]::Bold) }
}

function Save-Frame([int]$index, [string]$title, [string]$subtitle, [scriptblock]$draw) {
  $bmp = New-Object System.Drawing.Bitmap($script:W, $script:H)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  Draw-Shell $g $title $subtitle
  & $draw $g
  $captionY = 822
  $g.FillRectangle((Brush "#f2c94c"), 0, $captionY, $script:W, 78)
  Draw-Text $g "English screencast: install, billing, product sync, AI post generation, Facebook connection, calendar review, and publishing flow." 54 ($captionY + 22) 1450 34 24 "#17212b" ([System.Drawing.FontStyle]::Bold)
  $file = Join-Path $tempDir ("frame-{0:D2}.png" -f $index)
  $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  return $file
}

$frames = @()
$frames += Save-Frame 0 "Home onboarding" "Reviewer starts inside Shopify Admin after managed install." {
  param($g)
  Draw-Card $g 304 220 560 250 "Setup checklist"
  Draw-Badge $g "Step 1" 332 280
  Draw-Text $g "Approve the official Shopify Billing API trial. No external checkout is used." 332 330 480 70 24 "#17212b"
  Draw-Button $g "Start free trial" 332 414 190 "#008060"
  Draw-Card $g 900 220 420 250 "Current status"
  Draw-Text $g "Billing: waiting for approval`nProducts: not synced yet`nFacebook: not connected" 930 292 330 120 24 "#46515f"
}
$frames += Save-Frame 1 "Billing approval" "The app uses Shopify App Pricing / Billing API only." {
  param($g)
  Draw-Card $g 360 220 820 330 "Official billing approval"
  Draw-Text $g "Monthly plan" 408 300 300 35 28 "#17212b" ([System.Drawing.FontStyle]::Bold)
  Draw-Text $g '$29 USD / month after a 7-day free trial' 408 348 620 36 25 "#46515f"
  Draw-Text $g "If the reviewer closes this tab, Home and Compose both reopen a fresh approval URL." 408 404 650 64 23 "#46515f"
  Draw-Button $g "Approve" 408 490 150 "#008060"
  Draw-Button $g "Decline" 580 490 150 "#637381"
}
$frames += Save-Frame 2 "Products sync" "Reviewer imports catalog data using read_products." {
  param($g)
  Draw-Button $g "Sync products" 1120 118 180 "#008060"
  foreach ($i in 0..2) {
    $x = 314 + ($i * 330)
    Draw-Card $g $x 230 290 360 ""
    $colors = @("#d9edf7", "#fbe8cc", "#e8f7ee")
    $g.FillRectangle((Brush $colors[$i]), ($x + 24), 254, 242, 150)
    Draw-Text $g @("Canvas tote bag", "Ceramic coffee mug", "Desk plant gift set")[$i] ($x + 24) 430 242 34 24 "#17212b" ([System.Drawing.FontStyle]::Bold)
    Draw-Text $g @("$24.00 USD", "$18.00 USD", "$32.00 USD")[$i] ($x + 24) 474 220 30 22 "#616a75"
    Draw-Button $g "Compose post" ($x + 24) 520 170 "#008060"
  }
}
$frames += Save-Frame 3 "Compose post" "The reviewer clicks Compose post and receives editable content." {
  param($g)
  Draw-Card $g 304 220 570 430 "AI-generated caption"
  Draw-Text $g "Looking for something practical and easy to love? Meet the Canvas tote bag.`n`nRoomy, reusable, and ready for everyday errands, market mornings, or packing orders on the go.`n`nTake a look and see if it is the right fit for you." 334 284 500 220 24 "#17212b"
  Draw-Button $g "Save draft" 334 540 150 "#008060"
  Draw-Button $g "Publish now" 500 540 160 "#1f6f78"
  Draw-Card $g 910 220 390 430 "Facebook preview"
  Draw-RoundedRect $g 948 292 312 180 10 (Brush "#e8f7ee")
  Draw-Text $g "Canvas tote bag" 948 494 312 35 25 "#17212b" ([System.Drawing.FontStyle]::Bold)
  Draw-Text $g "Preview updates live as the caption is edited." 948 536 300 58 21 "#616a75"
}
$frames += Save-Frame 4 "Quality and fallback" "Provider hiccups no longer block review completion." {
  param($g)
  Draw-Card $g 330 230 860 300 "Critical error prevention"
  Draw-Text $g "If the AI caption or image provider is temporarily unavailable, Compose now returns an editable fallback caption and the product image instead of a 500/502 error." 380 310 760 90 28 "#17212b"
  Draw-Text $g "The merchant can still save a draft, schedule it, and continue testing the Calendar and Facebook connection flows." 380 424 760 70 24 "#46515f"
  Draw-Badge $g "No dead end" 380 520 "#e8f7ee" "#157347"
}
$frames += Save-Frame 5 "Facebook Page connection" "Settings demonstrates the external OAuth handoff." {
  param($g)
  Draw-Card $g 304 220 520 350 "Connected accounts"
  Draw-Text $g "Connect the reviewer Facebook Page from Settings. The popup requests only Facebook Page permissions used by this listing." 336 292 450 96 24 "#17212b"
  Draw-Button $g "Connect Facebook Page" 336 424 240 "#1877f2"
  Draw-Card $g 880 220 430 350 "Permissions"
  Draw-Text $g "pages_show_list`npages_read_engagement`npages_manage_posts" 920 302 340 115 24 "#46515f"
  Draw-Badge $g "Facebook only" 920 462 "#edf4ff" "#1877f2"
}
$frames += Save-Frame 6 "Calendar review" "Drafts and scheduled posts can be reviewed before publishing." {
  param($g)
  Draw-Card $g 304 220 990 420 "Content calendar"
  foreach ($i in 0..6) {
    $x = 334 + ($i * 132)
    Draw-RoundedRect $g $x 294 112 250 8 (Brush "#f6f6f7") (PenC "#d8dee4")
    Draw-Text $g @("Mon","Tue","Wed","Thu","Fri","Sat","Sun")[$i] ($x + 16) 316 80 26 20 "#616a75" ([System.Drawing.FontStyle]::Bold)
  }
  Draw-RoundedRect $g 354 378 230 78 8 (Brush "#e8f7ee")
  Draw-Text $g "Draft`nCanvas tote post" 374 392 190 52 20 "#17212b"
  Draw-RoundedRect $g 626 438 230 78 8 (Brush "#fff4d8")
  Draw-Text $g "Scheduled`nCoffee mug post" 646 452 190 52 20 "#17212b"
  Draw-RoundedRect $g 898 358 230 78 8 (Brush "#edf4ff")
  Draw-Text $g "Posted`nDesk plant post" 918 372 190 52 20 "#17212b"
}
$frames += Save-Frame 7 "End-to-end review path" "What Shopify reviewers should test." {
  param($g)
  Draw-Card $g 330 218 900 430 "Reviewer checklist"
  Draw-Text $g "1. Approve the Shopify billing trial.`n2. Sync products from the catalog.`n3. Generate a Facebook-ready post from any product.`n4. Connect the provided Facebook Page account in Settings.`n5. Save, schedule, or publish, then review Calendar and Insights." 380 294 800 230 28 "#17212b"
  Draw-Text $g "Screencast URL: https://app.socialaistudio.au/socialai-studio-reviewer-screencast.mp4" 380 570 780 34 22 "#46515f"
}

try {
  $concatFile = Join-Path $tempDir "concat.txt"
  $lines = New-Object System.Collections.Generic.List[string]
  foreach ($frame in $frames) {
    $safe = ($frame -replace "\\", "/").Replace("'", "'\''")
    $lines.Add("file '$safe'")
    $lines.Add("duration 25")
  }
  $safeLast = ($frames[-1] -replace "\\", "/").Replace("'", "'\''")
  $lines.Add("file '$safeLast'")
  Set-Content -Path $concatFile -Value ($lines -join "`n") -Encoding ASCII

  New-Item -ItemType Directory -Force -Path (Split-Path $outPath) | Out-Null
  & ffmpeg -y -hide_banner -loglevel warning -f concat -safe 0 -i $concatFile -vf "fps=30,format=yuv420p" -c:v libx264 -movflags +faststart $outPath
  if ($LASTEXITCODE -ne 0) {
    throw "ffmpeg exited with code $LASTEXITCODE"
  }

  Write-Host "Wrote $outPath"
} finally {
  Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}
