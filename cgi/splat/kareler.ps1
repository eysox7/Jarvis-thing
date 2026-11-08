<#
.SYNOPSIS
  Telefon videosunu Gaussian Splat eğitimi için karelere ayırır.

.DESCRIPTION
  3DGS eğitimi 150-300 keskin, birbiriyle örtüşen fotoğraf ister. Videodan
  saniyede birkaç kare alır, 1600 px'e küçültür (3DGS standardı; 8 GB VRAM ve
  16 GB RAM için ideal) ve yüksek kaliteli JPEG yazar.

  Çıkan klasör doğrudan Postshot, Brush (COLMAP ile) veya RealityScan'e verilir.

.EXAMPLE
  .\cgi\splat\kareler.ps1 -Video D:\cekim\salon.mp4
  .\cgi\splat\kareler.ps1 -Video D:\cekim\araba.mov -Fps 3 -Genislik 1920
#>
param(
    [Parameter(Mandatory)] [string] $Video,
    [string] $Cikti,
    [double] $Fps = 2,
    [int] $Genislik = 1600
)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) { throw 'ffmpeg yok. Kur: winget install Gyan.FFmpeg' }
$Video = (Resolve-Path $Video).Path
if (-not $Cikti) {
    $Cikti = Join-Path (Split-Path $Video) ([IO.Path]::GetFileNameWithoutExtension($Video) + '_splat\images')
}
New-Item -ItemType Directory -Force $Cikti | Out-Null

$sure = [double](& ffprobe -v error -show_entries format=duration -of csv=p=0 $Video)
$tahmin = [int]($sure * $Fps)
Write-Host ("[splat] {0:N0} sn video → yaklaşık {1} kare" -f $sure, $tahmin) -ForegroundColor Cyan
if ($tahmin -lt 80)  { Write-Host '  ! 80 kareden az: -Fps değerini artır ya da daha uzun çek.' -ForegroundColor Yellow }
if ($tahmin -gt 400) { Write-Host '  ! 400 kareden fazla: eğitim uzar, 16 GB RAM zorlanır. -Fps düşür.' -ForegroundColor Yellow }

& ffmpeg -hide_banner -loglevel error -y -i $Video -vf "fps=$Fps,scale='min($Genislik,iw)':-2" -qscale:v 2 (Join-Path $Cikti 'kare_%04d.jpg')
if ($LASTEXITCODE -ne 0) { throw "ffmpeg hata ile bitti ($LASTEXITCODE)" }
$n = (Get-ChildItem $Cikti -Filter 'kare_*.jpg').Count
Write-Host "[splat] $n kare → $Cikti" -ForegroundColor Green
Write-Host '  Sonraki adım: bu klasörü Postshot''a sürükle ya da COLMAP + Brush ile eğit (cgi\splat\README.md).'
