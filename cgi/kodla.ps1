<#
.SYNOPSIS
  PNG görüntü dizisini NVIDIA donanım kodlayıcısıyla (NVENC) videoya çevirir.

.DESCRIPTION
  NVENC, GPU'daki ayrı kodlama birimini kullanır: CPU'yu (x265) kullanan
  yazılım kodlamasına göre 5-20 kat hızlıdır ve render'ı yavaşlatmaz.

  Hedefler:
    youtube  10-bit HEVC (RTX 40/50'de AV1). Yüksek kalite, YouTube'a yükleme.
    sosyal   8-bit H.264. Instagram/TikTok/WhatsApp; her yerde oynar.
    master   DNxHR HQ (.mov). Kurgu programına (Resolve/Premiere) ara format.

  NVIDIA GPU yoksa otomatik olarak yazılım kodlayıcıya (x265/x264) düşer.

.EXAMPLE
  .\cgi\kodla.ps1 -Klasor D:\proje\render\intro\hizli -Hedef youtube -Fps 24
  .\cgi\kodla.ps1 -Klasor .\render\final -Hedef sosyal -Ses muzik.mp3
#>
param(
    [Parameter(Mandatory)] [string] $Klasor,
    [ValidateSet('youtube', 'sosyal', 'master')] [string] $Hedef = 'youtube',
    [int] $Fps = 24,
    [string] $Desen = 'kare_%04d.png',
    [string] $Ses,
    [string] $Cikti
)
$ErrorActionPreference = 'Stop'

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    throw 'ffmpeg yok. Kur: winget install Gyan.FFmpeg'
}
$Klasor = (Resolve-Path $Klasor).Path
$ilk = Get-ChildItem $Klasor -Filter 'kare_*.png' | Sort-Object Name | Select-Object -First 1
if (-not $ilk) { throw "$Klasor içinde kare_*.png yok." }
$basla = [int]($ilk.BaseName -replace '\D', '')

# NVENC var mı? Kodlayıcı listesinde olması yetmez; GPU'da gerçekten açılmalı.
function NvencCalisiyor($kodek) {
    # PowerShell 5.1'de stderr yönlendirmesi + 'Stop' hata fırlatır; yut.
    try {
        $null = & ffmpeg -hide_banner -loglevel error -f lavfi -i color=black:s=256x256:d=0.1 -c:v $kodek -f null - 2>&1
        return $LASTEXITCODE -eq 0
    } catch { return $false }
}
$av1 = $false
$gpu = ''
if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
    $gpu = (& nvidia-smi --query-gpu=name --format=csv,noheader | Select-Object -First 1)
    $av1 = $gpu -match 'RTX\s*(40|50)\d\d'
}

$v = @()
$uzanti = 'mp4'
switch ($Hedef) {
    'youtube' {
        if ($av1 -and (NvencCalisiyor 'av1_nvenc')) {
            $v = '-c:v', 'av1_nvenc', '-preset', 'p7', '-tune', 'hq', '-rc', 'vbr', '-cq', '24', '-b:v', '0',
                 '-spatial-aq', '1', '-temporal-aq', '1', '-pix_fmt', 'p010le'
        } elseif (NvencCalisiyor 'hevc_nvenc') {
            $v = '-c:v', 'hevc_nvenc', '-preset', 'p7', '-tune', 'hq', '-rc', 'vbr', '-cq', '19', '-b:v', '0',
                 '-spatial-aq', '1', '-temporal-aq', '1', '-pix_fmt', 'p010le', '-profile:v', 'main10', '-tag:v', 'hvc1'
        } else {
            $v = '-c:v', 'libx265', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p10le', '-tag:v', 'hvc1'
        }
    }
    'sosyal' {
        if (NvencCalisiyor 'h264_nvenc') {
            $v = '-c:v', 'h264_nvenc', '-preset', 'p7', '-tune', 'hq', '-rc', 'vbr', '-cq', '20', '-b:v', '0',
                 '-maxrate', '25M', '-bufsize', '50M', '-spatial-aq', '1', '-profile:v', 'high', '-pix_fmt', 'yuv420p'
        } else {
            $v = '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-profile:v', 'high', '-pix_fmt', 'yuv420p'
        }
    }
    'master' {
        $v = '-c:v', 'dnxhd', '-profile:v', 'dnxhr_hq', '-pix_fmt', 'yuv422p'
        $uzanti = 'mov'
    }
}

if (-not $Cikti) {
    $Cikti = Join-Path (Split-Path $Klasor) ("{0}_{1}.{2}" -f (Split-Path $Klasor -Leaf), $Hedef, $uzanti)
}

# Blender PNG'leri sRGB; videoda renk etiketlerini doğru yaz (soluk görünmesin).
$renk = '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'
# Tek sayılı çözünürlükleri kodlayıcılar kabul etmez: 2'ye yuvarla.
$filtre = '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2:out_color_matrix=bt709:out_range=tv'

$g = @('-hide_banner', '-y', '-framerate', $Fps, '-start_number', $basla, '-i', (Join-Path $Klasor $Desen))
$a = @()
if ($Ses) {
    $g += @('-i', $Ses)
    $a = if ($Hedef -eq 'master') { @('-c:a', 'pcm_s16le') } else { @('-c:a', 'aac', '-b:a', '320k') }
    $a += '-shortest'
}
$son = @()
if ($uzanti -eq 'mp4') { $son = @('-movflags', '+faststart') }

$tum = $g + $filtre + $v + $renk + $a + $son + @($Cikti)
Write-Host "[G870] $Hedef ($($v[1])) → $Cikti" -ForegroundColor Cyan
& ffmpeg @tum
if ($LASTEXITCODE -ne 0) { throw "ffmpeg hata ile bitti ($LASTEXITCODE)" }
Write-Host "[G870] hazır: $Cikti" -ForegroundColor Green
