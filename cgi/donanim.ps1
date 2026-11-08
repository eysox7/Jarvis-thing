<#
.SYNOPSIS
  Excalibur G870 donanım raporu ve CGI için öneriler.

.DESCRIPTION
  CPU, RAM, GPU/VRAM, sürücü, güç planı ve diski okur; hangi render
  profilinin ve hangi ayarların bu makineye uygun olduğunu söyler.
  Sonucu cgi\donanim.json dosyasına da yazar (diğer betikler okur).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File cgi\donanim.ps1
#>
$ErrorActionPreference = 'SilentlyContinue'
$sonuc = [ordered]@{}

function Baslik($t) { Write-Host "`n== $t ==" -ForegroundColor Cyan }
function Uyari($t)  { Write-Host "  ! $t" -ForegroundColor Yellow }
function Iyi($t)    { Write-Host "  + $t" -ForegroundColor Green }

# ---------------------------------------------------------------- sistem
Baslik 'Sistem'
$cs  = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$ram = [math]::Round($cs.TotalPhysicalMemory / 1GB)
$sonuc.model = "$($cs.Manufacturer) $($cs.Model)".Trim()
$sonuc.cpu   = $cpu.Name.Trim()
$sonuc.cekirdek = $cpu.NumberOfCores
$sonuc.izlek = $cpu.NumberOfLogicalProcessors
$sonuc.ram_gb = $ram
Write-Host "  Model : $($sonuc.model)"
Write-Host "  CPU   : $($sonuc.cpu) ($($sonuc.cekirdek) çekirdek / $($sonuc.izlek) izlek)"
Write-Host "  RAM   : $ram GB"
if ($ram -lt 32) { Uyari "RAM $ram GB. Simülasyon/büyük sahneler için 32 GB önerilir (G870'te 2 SO-DIMM yuvası var)." }
else { Iyi 'RAM yeterli.' }

# ------------------------------------------------------------------- GPU
Baslik 'GPU'
$smi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
if (-not $smi) {
    $alt = "$env:WINDIR\System32\nvidia-smi.exe"
    if (Test-Path $alt) { $smi = $alt }
}
if ($smi) {
    $satir = & $smi --query-gpu=name,memory.total,driver_version,power.limit,temperature.gpu --format=csv,noheader,nounits |
             Select-Object -First 1
    $p = $satir -split ',\s*'
    $sonuc.gpu      = $p[0]
    $sonuc.vram_gb  = [math]::Round([double]$p[1] / 1024, 1)
    $sonuc.surucu   = $p[2]
    $sonuc.guc_w    = $p[3]
    $sonuc.sicaklik = $p[4]
    Write-Host "  GPU    : $($sonuc.gpu)"
    Write-Host "  VRAM   : $($sonuc.vram_gb) GB"
    Write-Host "  Sürücü : $($sonuc.surucu)"
    Write-Host "  Güç    : $($sonuc.guc_w) W  (TGP; Casper Control Center 'Performans/Turbo' modunda en yüksek)"
    Write-Host "  Sıcaklık: $($sonuc.sicaklik) °C"
    $sonuc.av1_nvenc = [bool]($sonuc.gpu -match 'RTX\s*(40|50)\d\d')
    if ($sonuc.vram_gb -le 6.5) { Uyari '6 GB VRAM: dokuları 2K ile sınırla, büyük sahnelerde EEVEE ya da Simplify kullan.' }
    elseif ($sonuc.vram_gb -le 8.5) { Iyi '8 GB VRAM: çoğu sahne için yeterli; 4K doku sınırı uygulanacak.' }
    else { Iyi "$($sonuc.vram_gb) GB VRAM: doku sınırı gerekmez." }
    if ($sonuc.av1_nvenc) { Iyi 'RTX 40/50: AV1 donanım kodlayıcı (av1_nvenc) var.' }
    else { Write-Host '  · AV1 donanım kodlama yok; HEVC (hevc_nvenc) kullanılacak.' }
} else {
    $sonuc.gpu = (Get-CimInstance Win32_VideoController | ForEach-Object Name) -join ' / '
    Uyari "nvidia-smi bulunamadı. Görünen: $($sonuc.gpu)"
    Uyari 'NVIDIA Studio sürücüsünü kur: https://www.nvidia.com/drivers (Ürün tipi: Studio).'
}

# ------------------------------------------------------- güç ve ekran
Baslik 'Güç'
$plan = (powercfg /getactivescheme) -replace '.*\((.*)\).*', '$1'
$sonuc.guc_plani = $plan
Write-Host "  Etkin güç planı: $plan"
$pil = Get-CimInstance Win32_Battery
if ($pil -and $pil.BatteryStatus -eq 1) {
    Uyari 'Pil ile çalışıyor! Render öncesi adaptörü tak — pilde GPU gücü ciddi kısılır.'
}
Write-Host '  · Render için: adaptör takılı + Casper Control Center → Performans/Turbo + fan maksimum.'
Write-Host '  · Ekran kartı modu: Control Center''da "Discrete/dGPU" (MUX) seç; Optimus''tan ~%5-10 hızlı.'

# ------------------------------------------------------------------ disk
Baslik 'Disk'
Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
    $bos = [math]::Round($_.FreeSpace / 1GB)
    Write-Host ("  {0} {1,5} GB boş" -f $_.DeviceID, $bos)
    if ($bos -lt 100) { Uyari "$($_.DeviceID) üzerinde 100 GB altı boş alan: EXR dizileri hızla yer kaplar." }
}

# ----------------------------------------------------------- yazılımlar
Baslik 'Yazılımlar'
$blender = Get-ChildItem 'C:\Program Files\Blender Foundation' -Filter blender.exe -Recurse -ErrorAction SilentlyContinue |
           Sort-Object FullName -Descending | Select-Object -First 1
$sonuc.blender = if ($blender) { $blender.FullName } else { $null }
$sonuc.ffmpeg  = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
if ($sonuc.blender) { Iyi "Blender: $($sonuc.blender)" } else { Uyari 'Blender yok → winget install BlenderFoundation.Blender  (ya da blender.org → LTS sürüm)' }
if ($sonuc.ffmpeg)  { Iyi "FFmpeg : $($sonuc.ffmpeg)" }  else { Uyari 'FFmpeg yok → winget install Gyan.FFmpeg' }

# ---------------------------------------------------------------- öneri
Baslik 'Öneri'
$v = $sonuc.vram_gb
if (-not $v) { Write-Host '  GPU okunamadı; önce sürücüyü kur ve betiği tekrar çalıştır.' }
else {
    Write-Host '  Işık/kamera denemesi : g870_profil.py --profil onizleme'
    Write-Host '  Animasyon / sosyal   : g870_profil.py --profil hizli      (EEVEE)'
    Write-Host '  Still / ürün görseli : g870_profil.py --profil final      (Cycles + OptiX)'
    Write-Host '  Film / reklam        : g870_profil.py --profil sinematik  (Cycles + EXR → Resolve)'
}

$yol = Join-Path $PSScriptRoot 'donanim.json'
$sonuc | ConvertTo-Json | Set-Content -Encoding UTF8 $yol
Write-Host "`nRapor: $yol"
