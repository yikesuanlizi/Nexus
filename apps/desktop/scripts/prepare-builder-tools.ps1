# One-shot preparation of electron-builder's Windows packaging tools
# (NSIS + winCodeSign). Use it when the network blocks electron-builder's
# automatic downloads: it downloads the archives and places them in the cache.
# Usage (PowerShell):
#   powershell -ExecutionPolicy Bypass -File apps/desktop/scripts/prepare-builder-tools.ps1
# Then re-run:
#   npm run desktop:build

$ErrorActionPreference = 'Stop'

# PowerShell 5.1 默认 TLS 1.0/1.1；GitHub 仅接受 TLS 1.2+。
# — English: PowerShell 5.1 defaults to TLS 1.0/1.1; GitHub only accepts TLS 1.2+.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$VersionNsis = 'nsis-3.0.4.1'
$VersionWinCodeSign = 'winCodeSign-2.6.0'
$BaseUrl = 'https://github.com/electron-userland/electron-builder-binaries/releases/download'

# electron-builder cache root (Windows).
$CacheRoot = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache'

$Downloads = @(
  @{ Name = 'nsis';        Release = $VersionNsis;        Url = "$BaseUrl/$VersionNsis/$VersionNsis.7z" },
  @{ Name = 'winCodeSign'; Release = $VersionWinCodeSign; Url = "$BaseUrl/$VersionWinCodeSign/$VersionWinCodeSign.7z" }
)

# Windows ships bsdtar (System32\tar.exe) which reads .7z; GNU tar does not.
$BsdTar = Join-Path $env:WINDIR 'System32\tar.exe'

foreach ($dl in $Downloads) {
  $destDir = Join-Path $CacheRoot (Join-Path $dl.Name $dl.Release)
  $marker = Join-Path $destDir '.complete'
  if (Test-Path $marker) {
    Write-Host "[ok] $($dl.Release) already ready (skipped)" -ForegroundColor Green
    continue
  }

  Write-Host "[..] downloading $($dl.Release) ..."
  $archive = Join-Path $env:TEMP "$($dl.Release).7z"
  # 优先 curl.exe（Windows 自带，schannel 自动协商 TLS 1.2+）；失败再退 Invoke-WebRequest。
  # — English: prefer curl.exe (ships with Windows, schannel negotiates TLS 1.2+);
  #   fall back to Invoke-WebRequest.
  $curl = Join-Path $env:WINDIR 'System32\curl.exe'
  if (Test-Path $curl) {
    & $curl -L --fail --silent --show-error -o $archive $dl.Url
    if ($LASTEXITCODE -ne 0) {
      Write-Host "[err] curl download failed (exit $LASTEXITCODE): $($dl.Url)" -ForegroundColor Red
      throw "download failed: $($dl.Release)"
    }
  } else {
    Invoke-WebRequest -Uri $dl.Url -OutFile $archive -UseBasicParsing
  }

  if (Test-Path $destDir) { Remove-Item $destDir -Recurse -Force }
  New-Item -ItemType Directory -Path $destDir -Force | Out-Null

  Write-Host "[..] extracting $($dl.Release) ..."
  & $BsdTar -xf $archive -C $destDir
  if ($LASTEXITCODE -ne 0) { throw "extract failed: $($dl.Release)" }
  Remove-Item $archive -Force

  Set-Content -Path $marker -Value 'done'
  Write-Host "[ok] $($dl.Release) -> $destDir" -ForegroundColor Green
}

Write-Host ''
Write-Host 'Tools are ready. Now run:' -ForegroundColor Cyan
Write-Host '  npm run desktop:build' -ForegroundColor Yellow
