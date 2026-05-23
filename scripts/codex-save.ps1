[CmdletBinding()]
param(
  [string]$BackupRoot = "D:\GitHubBackup",
  [string]$ProjectName = "SocialAi",
  [string]$Message = "",
  [switch]$NoPush,
  [switch]$NoBackup,
  [switch]$NoCommit,
  [switch]$SkipWorkingTreeMirror
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Invoke-Git {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  & git @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }
}

function Get-GitOutput {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  $output = & git @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }

  return ($output -join "`n").Trim()
}

$repoRoot = Get-GitOutput @("rev-parse", "--show-toplevel")
Set-Location $repoRoot

$repoName = Split-Path -Path $repoRoot -Leaf
$branch = Get-GitOutput @("branch", "--show-current")
$hasBranch = -not [string]::IsNullOrWhiteSpace($branch)
$remoteOutput = Get-GitOutput @("remote")
$remoteNames = @($remoteOutput -split "`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
$remote = if ($remoteNames -contains "origin") { "origin" } elseif ($remoteNames.Count -gt 0) { $remoteNames[0] } else { "" }
$timestamp = Get-Date
$timestampText = $timestamp.ToString("yyyy-MM-dd HH:mm:ss zzz")

Write-Host "Repo: $repoRoot"
Write-Host "Backup root: $BackupRoot"
Write-Host "Backup project: $ProjectName"

if (-not $NoCommit) {
  $statusOutput = Get-GitOutput @("status", "--porcelain=v1")
  $status = @($statusOutput -split "`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })

  if ($status.Count -gt 0) {
    Invoke-Git @("add", "-A")

    if ([string]::IsNullOrWhiteSpace($Message)) {
      $Message = "chore: codex autosave $($timestamp.ToString('yyyy-MM-dd HH:mm'))"
    }

    $body = "Automated Codex save at $timestampText from $env:COMPUTERNAME. Backup target: $BackupRoot\$ProjectName."
    Invoke-Git @("commit", "-m", $Message, "-m", $body)
  } else {
    Write-Host "No git changes to commit."
  }
}

if (-not $NoPush) {
  if ([string]::IsNullOrWhiteSpace($remote)) {
    Write-Warning "No git remote configured; skipping push."
  } elseif (-not $hasBranch) {
    Write-Warning "Detached HEAD; skipping push."
  } else {
    Invoke-Git @("push", "-u", $remote, $branch)
  }
}

if (-not $NoBackup) {
  if (-not (Test-Path -Path $BackupRoot)) {
    New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
  }

  $backupDir = Join-Path -Path $BackupRoot -ChildPath $ProjectName
  $bundleDir = Join-Path -Path $backupDir -ChildPath "git-bundles"
  $metadataDir = Join-Path -Path $backupDir -ChildPath "metadata"
  New-Item -ItemType Directory -Path $bundleDir -Force | Out-Null
  New-Item -ItemType Directory -Path $metadataDir -Force | Out-Null

  $bundlePath = Join-Path -Path $bundleDir -ChildPath "$ProjectName.bundle"
  Invoke-Git @("bundle", "create", $bundlePath, "--all")

  $commit = Get-GitOutput @("rev-parse", "HEAD")
  $remoteUrl = if ([string]::IsNullOrWhiteSpace($remote)) { "" } else { Get-GitOutput @("remote", "get-url", $remote) }
  $manifest = [ordered]@{
    savedAt = (Get-Date).ToString("o")
    projectName = $ProjectName
    repoName = $repoName
    repoRoot = $repoRoot
    branch = $branch
    commit = $commit
    remote = $remote
    remoteUrl = $remoteUrl
    bundle = $bundlePath
  } | ConvertTo-Json

  Set-Content -Path (Join-Path -Path $metadataDir -ChildPath "last-save.json") -Value $manifest -Encoding UTF8

  if (-not $SkipWorkingTreeMirror) {
    $treeDir = Join-Path -Path $backupDir -ChildPath "working-tree"
    New-Item -ItemType Directory -Path $treeDir -Force | Out-Null

    $excludeDirs = @(
      (Join-Path -Path $repoRoot -ChildPath ".git"),
      (Join-Path -Path $repoRoot -ChildPath "node_modules"),
      (Join-Path -Path $repoRoot -ChildPath "dist"),
      (Join-Path -Path $repoRoot -ChildPath ".wrangler"),
      (Join-Path -Path $repoRoot -ChildPath "workers\api\.wrangler"),
      (Join-Path -Path $repoRoot -ChildPath "workers\api\node_modules"),
      (Join-Path -Path $repoRoot -ChildPath "shopify-app\node_modules"),
      (Join-Path -Path $repoRoot -ChildPath "shopify-app\dist"),
      (Join-Path -Path $repoRoot -ChildPath ".claude\plans"),
      (Join-Path -Path $repoRoot -ChildPath ".claude\worktrees")
    )
    $excludeFiles = @("*.log")
    $robocopyArgs = @($repoRoot, $treeDir, "/MIR", "/XD") + $excludeDirs + @("/XF") + $excludeFiles + @("/R:2", "/W:2", "/NP")

    & robocopy @robocopyArgs
    $robocopyExit = $LASTEXITCODE
    if ($robocopyExit -ge 8) {
      throw "robocopy failed with exit code $robocopyExit"
    }
  }

  Write-Host "Backup saved to $backupDir"
}

Write-Host "Codex save complete."
