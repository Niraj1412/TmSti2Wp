param(
  [string]$Package = "video",
  [string]$Version = "6.0-2",
  [string]$User,
  [string]$Token
)

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$AndroidDir = Join-Path $ProjectRoot "android"
$LocalRepo = Join-Path $AndroidDir "ffmpeg-kit-local"

function Get-GradleProp {
  param(
    [string]$Path,
    [string]$Key
  )
  if (-not (Test-Path $Path)) { return $null }
  $line = Get-Content $Path | Where-Object { $_ -match "^\s*$([regex]::Escape($Key))\s*=" } | Select-Object -First 1
  if (-not $line) { return $null }
  return ($line -split "=", 2)[1].Trim()
}

$user = $User
$token = $Token
if (-not $user) { $user = $env:GPR_USER }
if (-not $token) { $token = $env:GPR_KEY }
if (-not $user -or -not $token) {
  $userGradle = Join-Path $env:USERPROFILE ".gradle\\gradle.properties"
  $projectGradle = Join-Path $AndroidDir "gradle.properties"
  if (-not $user) { $user = Get-GradleProp -Path $userGradle -Key "gpr.user" }
  if (-not $token) { $token = Get-GradleProp -Path $userGradle -Key "gpr.key" }
  if (-not $user) { $user = Get-GradleProp -Path $projectGradle -Key "gpr.user" }
  if (-not $token) { $token = Get-GradleProp -Path $projectGradle -Key "gpr.key" }
}

if (-not $user -or -not $token) {
  Write-Error "Missing GitHub Packages credentials. Set GPR_USER/GPR_KEY or add gpr.user/gpr.key to %USERPROFILE%\\.gradle\\gradle.properties."
  exit 1
}

$packageName = "ffmpeg-kit-$Package"
$targetDir = Join-Path $LocalRepo ("com\\arthenica\\$packageName\\$Version")
New-Item -ItemType Directory -Path $targetDir -Force | Out-Null

$auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("$user`:$token"))
$headers = @{ Authorization = "Basic $auth" }
$baseUrls = @(
  "https://maven.pkg.github.com/arthenica/ffmpeg-kit",
  "https://maven.pkg.github.com/ffmpeg-kit/ffmpeg-kit"
)

$files = @(
  "$packageName-$Version.pom",
  "$packageName-$Version.aar",
  "$packageName-$Version.module"
)

Write-Host "Downloading $packageName $Version from GitHub Packages as $user..."

$downloaded = $false
foreach ($base in $baseUrls) {
  $success = $true
  foreach ($file in $files) {
    $url = "$base/com/arthenica/$packageName/$Version/$file"
    $outPath = Join-Path $targetDir $file
    try {
      Invoke-WebRequest -UseBasicParsing -Uri $url -Headers $headers -OutFile $outPath -ErrorAction Stop
    } catch {
      if ($file -like "*.module") {
        if (Test-Path $outPath) { Remove-Item $outPath -Force }
        continue
      }
      $success = $false
      break
    }
  }
  if ($success) {
    $downloaded = $true
    break
  }

  foreach ($file in $files) {
    $outPath = Join-Path $targetDir $file
    if (Test-Path $outPath) { Remove-Item $outPath -Force }
  }
}

if (-not $downloaded) {
  Write-Error "Failed to download $packageName $Version from GitHub Packages. Verify your token has read:packages and that SSO is authorized."
  exit 1
}

Write-Host "FFmpegKit artifacts saved to $targetDir"
