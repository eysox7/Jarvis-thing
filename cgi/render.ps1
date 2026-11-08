<#
.SYNOPSIS
  Blender sahnesini G870 profiliyle arka planda (arayüzsüz) render eder.

.DESCRIPTION
  Arayüz açıkken render almak VRAM'in bir kısmını viewport'a harcar ve
  yavaştır. Bu betik Blender'ı -b (background) ile çalıştırır, profil
  ayarlarını uygular ve kareleri görüntü dizisi olarak yazar.
  Yarıda kalırsa aynı komutu tekrar çalıştır: biten kareler atlanır.

.EXAMPLE
  .\cgi\render.ps1 -Sahne D:\proje\reklam.blend -Profil sinematik
  .\cgi\render.ps1 -Sahne D:\proje\urun.blend -Profil final -Kare 1
  .\cgi\render.ps1 -Sahne D:\proje\intro.blend -Profil hizli -Kodla youtube
#>
param(
    [Parameter(Mandatory)] [string] $Sahne,
    [ValidateSet('onizleme', 'hizli', 'final', 'sinematik')] [string] $Profil = 'final',
    [int] $Kare = -1,
    [string] $Cikti,
    [string] $Blender,
    [ValidateSet('', 'youtube', 'sosyal', 'master')] [string] $Kodla = '',
    [int] $Fps = 0
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Sahne)) { throw "Sahne bulunamadı: $Sahne" }
$Sahne = (Resolve-Path $Sahne).Path

if (-not $Blender) {
    $Blender = (Get-Command blender -ErrorAction SilentlyContinue).Source
    if (-not $Blender) {
        $Blender = Get-ChildItem 'C:\Program Files\Blender Foundation' -Filter blender.exe -Recurse -ErrorAction SilentlyContinue |
                   Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
    }
}
if (-not $Blender) { throw 'blender.exe bulunamadı. -Blender "C:\...\blender.exe" ile ver.' }

if (-not $Cikti) {
    $Cikti = Join-Path (Split-Path $Sahne) ("render\{0}\{1}" -f [IO.Path]::GetFileNameWithoutExtension($Sahne), $Profil)
}
New-Item -ItemType Directory -Force $Cikti | Out-Null

$profilPy = Join-Path $PSScriptRoot 'blender\g870_profil.py'
$argsPy = @('--profil', $Profil, '--cikti', $Cikti)
if ($Kare -ge 0) { $argsPy += @('--kare', $Kare) } else { $argsPy += '--render' }

$bas = Get-Date
Write-Host "[G870] $Profil → $Cikti" -ForegroundColor Cyan
# '--' tırnak içinde: PowerShell çıplak -- işaretini yutabilir.
$tum = @('-b', $Sahne, '--python-exit-code', '1', '-P', $profilPy, '--') + $argsPy
& $Blender @tum
if ($LASTEXITCODE -ne 0) { throw "Blender hata ile bitti ($LASTEXITCODE)" }
$sure = (Get-Date) - $bas
Write-Host ("[G870] bitti: {0:hh\:mm\:ss}" -f $sure) -ForegroundColor Green

if ($Kodla -and $Kare -lt 0) {
    if ($Profil -eq 'sinematik') {
        Write-Host '[G870] Sinematik çıktı EXR: kurgu/renk için DaVinci Resolve''a doğrudan aktar.' -ForegroundColor Yellow
    } else {
        $kargs = @{ Klasor = $Cikti; Hedef = $Kodla }
        if ($Fps -gt 0) { $kargs.Fps = $Fps }
        & (Join-Path $PSScriptRoot 'kodla.ps1') @kargs
    }
}
