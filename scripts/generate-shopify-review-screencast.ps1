param(
  [string]$Output = "shopify-app/public/socialai-studio-reviewer-screencast.mp4"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$outPath = Join-Path $root $Output
$tempDir = Join-Path $env:TEMP ("socialai-shopify-screencast-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

$font = "C\:/Windows/Fonts/arial.ttf"
$slides = @(
  @{
    Title = "SocialAI Studio for Shopify"
    Body = @(
      "Reviewer walkthrough for app reference 116333",
      "This video shows setup, billing, Facebook connection, AI generation, and calendar review."
    )
  },
  @{
    Title = "1. Install and open the embedded app"
    Body = @(
      "Install SocialAI Studio on the Shopify development store.",
      "The app opens inside Shopify Admin using App Bridge session tokens.",
      "No off-platform account or payment screen is required."
    )
  },
  @{
    Title = "2. Approve Shopify Billing API trial"
    Body = @(
      "On Home, click Start free trial.",
      "Shopify opens the official billing approval flow.",
      "If the tab is closed, Waiting for billing approval now reopens a fresh approval URL."
    )
  },
  @{
    Title = "3. Sync products"
    Body = @(
      "Open Products and click Sync products.",
      "The app reads the Shopify catalog through the approved read_products scope.",
      "Synced products are used only to generate product-aware Facebook post drafts."
    )
  },
  @{
    Title = "4. Generate a Facebook-ready post"
    Body = @(
      "Click Compose post on any product.",
      "SocialAI generates a caption and matching image for Facebook Page posting.",
      "If billing is not approved, the app shows Open billing approval instead of a hard error."
    )
  },
  @{
    Title = "5. Connect Facebook Page"
    Body = @(
      "Open Settings and click Connect Facebook Page.",
      "Use the Facebook test credentials provided in the secure Partner Dashboard field.",
      "The OAuth popup requests only pages_show_list, pages_read_engagement, and pages_manage_posts."
    )
  },
  @{
    Title = "6. Schedule and review"
    Body = @(
      "Save the generated post as a draft or schedule it in Calendar.",
      "Calendar shows Draft, Scheduled, Posted, and Missed states.",
      "Publish Now uses the connected Facebook Page token."
    )
  },
  @{
    Title = "7. Pricing and plan changes"
    Body = @(
      "The app uses Shopify App Pricing / Billing API only.",
      "Merchants can approve, decline, retry, and manage billing from Shopify Admin.",
      "No Stripe, PayPal, invoice, or external checkout is used by the Shopify embedded app."
    )
  }
)

try {
  $filters = New-Object System.Collections.Generic.List[string]
  $labels = New-Object System.Collections.Generic.List[string]

  for ($i = 0; $i -lt $slides.Count; $i++) {
    $titleFile = Join-Path $tempDir ("title-$i.txt")
    $bodyFile = Join-Path $tempDir ("body-$i.txt")
    Set-Content -Path $titleFile -Value $slides[$i].Title -Encoding UTF8
    Set-Content -Path $bodyFile -Value (($slides[$i].Body) -join "`n") -Encoding UTF8

    $titlePath = ($titleFile -replace "\\", "/") -replace ":", "\:"
    $bodyPath = ($bodyFile -replace "\\", "/") -replace ":", "\:"

    $filters.Add(
      "color=c=0x101820:s=1600x900:d=7[base$i];" +
      "[base$i]drawbox=x=0:y=0:w=1600:h=86:color=0x1f6f78@0.95:t=fill," +
      "drawbox=x=0:y=814:w=1600:h=86:color=0xf2c94c@0.95:t=fill," +
      "drawtext=fontfile='$font':textfile='$titlePath':fontcolor=white:fontsize=58:x=96:y=150:line_spacing=12," +
      "drawtext=fontfile='$font':textfile='$bodyPath':fontcolor=white:fontsize=39:x=100:y=300:line_spacing=22," +
      "drawtext=fontfile='$font':text='SocialAI Studio - Shopify App Review':fontcolor=0x101820:fontsize=32:x=100:y=842[v$i]"
    )
    $labels.Add("[v$i]")
  }

  $concat = ($labels -join "") + "concat=n=$($slides.Count):v=1:a=0,format=yuv420p[v]"
  $filterComplex = ($filters -join ";") + ";" + $concat

  New-Item -ItemType Directory -Force -Path (Split-Path $outPath) | Out-Null
  & ffmpeg -y -hide_banner -loglevel warning -filter_complex $filterComplex -map "[v]" -r 30 -movflags +faststart $outPath
  if ($LASTEXITCODE -ne 0) {
    throw "ffmpeg exited with code $LASTEXITCODE"
  }

  Write-Host "Wrote $outPath"
} finally {
  Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}
