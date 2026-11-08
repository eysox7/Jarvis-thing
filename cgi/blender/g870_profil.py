"""
Casper Excalibur G870 için Blender render profili.

Blender 4.2+ / 5.x ile çalışır. Sahneyi açık dosyaya uygular; GUI'de
Scripting sekmesinden "Run Script" ile ya da komut satırından:

    blender -b sahne.blend -P g870_profil.py -- --profil final
    blender -b sahne.blend -P g870_profil.py -- --profil sinematik --render
    blender -b sahne.blend -P g870_profil.py -- --profil onizleme --vram 6 --kaydet

Seçenekler (hepsi isteğe bağlı):
    --profil    onizleme | hizli | final | sinematik   (varsayılan: final)
    --vram      GPU belleği (GB). Verilmezse nvidia-smi'den okunur.
    --cikti     Çıktı klasörü (varsayılan: //render/<profil>/)
    --render    Ayarlardan sonra animasyonu render et.
    --kare      Tek kare render et (ör. --kare 120).
    --kaydet    Ayarları .blend dosyasına kaydet.

Profiller:
    onizleme   Cycles, %50 çözünürlük, 32 örnek. Işık/kamera kontrolü için.
    hizli      EEVEE (raytracing açık). Animasyon ve sosyal medya içerikleri.
               Cycles'a göre 10-50 kat hızlı.
    final      Cycles, adaptif örnekleme + OptiX denoise. Tek kare / still.
    sinematik  Cycles + hareket bulanıklığı + çok katmanlı EXR. Kurgu ve
               renk düzeltmesi (DaVinci Resolve) için.
"""

import os
import subprocess
import sys

import bpy


# ---------------------------------------------------------------- yardımcılar

def log(msg):
    print(f"[G870] {msg}", flush=True)


def ayarla(obj, ad, deger):
    """Özelliği varsa ve değer geçerliyse ayarla; sürüm farklarında çökme."""
    if obj is None or not hasattr(obj, ad):
        return False
    try:
        setattr(obj, ad, deger)
        return True
    except (TypeError, ValueError, AttributeError) as e:
        log(f"atlandı: {ad}={deger!r} ({e})")
        return False


def argumanlar(argv):
    argv = argv[argv.index("--") + 1:] if "--" in argv else []
    a = {"profil": "final", "vram": None, "cikti": None,
         "render": False, "kare": None, "kaydet": False}
    i = 0
    while i < len(argv):
        k = argv[i].lstrip("-")
        if k in ("render", "kaydet"):
            a[k] = True
        elif k in ("profil", "vram", "cikti", "kare") and i + 1 < len(argv):
            a[k] = argv[i + 1]
            i += 1
        else:
            log(f"bilinmeyen argüman: {argv[i]}")
        i += 1
    if a["vram"] is not None:
        a["vram"] = float(a["vram"])
    if a["kare"] is not None:
        a["kare"] = int(a["kare"])
    if a["profil"] not in PROFILLER:
        raise SystemExit(f"[G870] profil yok: {a['profil']} "
                         f"(seçenekler: {', '.join(PROFILLER)})")
    return a


def gpu_bilgisi():
    """(ad, vram_gb) — nvidia-smi yoksa (None, None)."""
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10, check=True).stdout
        ad, mib = out.strip().splitlines()[0].rsplit(",", 1)
        return ad.strip(), round(float(mib) / 1024, 1)
    except (OSError, subprocess.SubprocessError, ValueError, IndexError):
        return None, None


# ------------------------------------------------------------------- donanım

def gpu_hazirla():
    """OptiX > CUDA sırasıyla GPU'yu aç, CPU'yu render'dan çıkar.

    Dizüstünde CPU+GPU hibrit render genelde YAVAŞLATIR: CPU ısınınca ortak
    soğutma GPU'yu da kısar. Bu yüzden yalnızca GPU kullanılır.
    """
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
    except KeyError:
        log("Cycles eklentisi yok")
        return None
    for tur in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = tur
        except TypeError:
            continue
        prefs.refresh_devices()
        gpular = [d for d in prefs.devices if d.type == tur]
        if not gpular:
            continue
        for d in prefs.devices:
            d.use = d.type == tur
        log(f"GPU: {tur} → {', '.join(d.name for d in gpular)}")
        return tur
    log("NVIDIA GPU bulunamadı — CPU ile render edilecek (yavaş). "
        "Sürücüyü ve Casper Control Center'da dGPU/MUX modunu kontrol et.")
    return None


def vram_kademesi(vram):
    """VRAM'e göre doku sınırı ve karo boyutu.

    G870 yapılandırmaları: RTX 3060 6GB, RTX 4060 8GB, RTX 3070/Ti 8GB,
    RTX 4070 8GB. VRAM dolarsa Cycles ya çöker ya da çok yavaşlar.
    """
    if vram is None:
        vram = 8.0
    if vram <= 6.5:
        return {"doku": "2048", "karo": 1024, "kalici": False}
    if vram <= 8.5:
        return {"doku": "4096", "karo": 2048, "kalici": True}
    return {"doku": "OFF", "karo": 2048, "kalici": True}


# ------------------------------------------------------------------ profiller

def ortak(scene, kademe):
    r = scene.render
    ayarla(r, "use_persistent_data", kademe["kalici"])   # BVH tekrar kurulmaz
    ayarla(r, "use_simplify", False)
    ayarla(scene.view_settings, "view_transform", "AgX")
    ayarla(scene.view_settings, "look", "None")
    ayarla(r, "compositor_device", "GPU")
    # Çökme/ısınma durumunda kaldığı yerden devam: var olan kareyi atla.
    ayarla(r, "use_overwrite", False)
    ayarla(r, "use_placeholder", True)


def cycles_temel(scene, kademe, tur):
    scene.render.engine = "CYCLES"
    c = scene.cycles
    ayarla(c, "device", "GPU" if tur else "CPU")
    ayarla(c, "use_adaptive_sampling", True)
    ayarla(c, "use_light_tree", True)
    ayarla(c, "use_auto_tile", True)
    ayarla(c, "tile_size", kademe["karo"])
    ayarla(c, "texture_limit_render", kademe["doku"])
    ayarla(c, "use_denoising", True)
    # OptiX denoiser RTX'te en hızlısı; yoksa OIDN (GPU) kullanılır.
    if not (tur == "OPTIX" and ayarla(c, "denoiser", "OPTIX")):
        ayarla(c, "denoiser", "OPENIMAGEDENOISE")
        ayarla(c, "denoising_use_gpu", True)
    ayarla(c, "denoising_input_passes", "RGB_ALBEDO_NORMAL")
    ayarla(c, "denoising_prefilter", "ACCURATE")
    # Görsel farkı az, süre farkı büyük ışık sekmesi ayarları.
    ayarla(c, "max_bounces", 8)
    ayarla(c, "diffuse_bounces", 3)
    ayarla(c, "glossy_bounces", 4)
    ayarla(c, "transmission_bounces", 8)
    ayarla(c, "volume_bounces", 1)
    ayarla(c, "transparent_max_bounces", 8)
    ayarla(c, "sample_clamp_indirect", 10.0)   # ateş böceği (firefly) keser
    ayarla(c, "caustics_reflective", False)
    ayarla(c, "caustics_refractive", False)
    ayarla(c, "blur_glossy", 1.0)
    # Viewport: hızlı önizleme
    ayarla(c, "preview_samples", 64)
    ayarla(c, "use_preview_denoising", True)
    ayarla(c, "preview_denoising_start_sample", 1)


def p_onizleme(scene, kademe, tur):
    cycles_temel(scene, kademe, tur)
    c = scene.cycles
    ayarla(c, "samples", 32)
    ayarla(c, "adaptive_threshold", 0.1)
    ayarla(c, "max_bounces", 4)
    ayarla(scene.render, "resolution_percentage", 50)
    ayarla(scene.render, "use_motion_blur", False)
    cikti_png(scene)


def p_hizli(scene, kademe, tur):
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [
        i.identifier for i in scene.render.bl_rna.properties["engine"].enum_items
    ] else "BLENDER_EEVEE"
    e = scene.eevee
    ayarla(e, "taa_render_samples", 64)
    ayarla(e, "use_raytracing", True)
    ayarla(e, "ray_tracing_method", "SCREEN")
    ayarla(e, "use_fast_gi", True)
    ayarla(e, "fast_gi_method", "GLOBAL_ILLUMINATION")
    ayarla(e, "use_shadows", True)
    ayarla(e, "shadow_ray_count", 1)
    ayarla(e, "shadow_step_count", 6)
    ayarla(e, "volumetric_tile_size", "8")
    ayarla(e, "volumetric_samples", 64)
    ayarla(e, "use_volumetric_shadows", True)
    ayarla(e, "shadow_pool_size", "512" if kademe["doku"] != "2048" else "256")
    ayarla(scene.render, "resolution_percentage", 100)
    ayarla(scene.render, "use_motion_blur", True)
    ayarla(e, "motion_blur_steps", 1)
    cikti_png(scene)


def p_final(scene, kademe, tur):
    cycles_temel(scene, kademe, tur)
    c = scene.cycles
    ayarla(c, "samples", 1024)            # tavan; adaptif genelde çok önce durur
    ayarla(c, "adaptive_threshold", 0.01)
    ayarla(c, "adaptive_min_samples", 0)
    ayarla(scene.render, "resolution_percentage", 100)
    ayarla(scene.render, "use_motion_blur", False)
    cikti_png(scene)


def p_sinematik(scene, kademe, tur):
    cycles_temel(scene, kademe, tur)
    c = scene.cycles
    ayarla(c, "samples", 512)
    ayarla(c, "adaptive_threshold", 0.02)
    ayarla(c, "use_animated_seed", True)  # gürültü kareler arası "kaynamaz"
    ayarla(scene.render, "resolution_percentage", 100)
    ayarla(scene.render, "use_motion_blur", True)
    ayarla(scene.render, "motion_blur_shutter", 0.5)   # 180° obtüratör
    # Denoise'u render'da değil, kurguya hazır pass'larla yapmak isteyenler
    # için albedo/normal pass'larını da yaz.
    vl = bpy.context.view_layer
    ayarla(vl, "use_pass_z", True)
    ayarla(vl, "use_pass_vector", True)
    ayarla(vl.cycles, "denoising_store_passes", True)
    cikti_exr(scene)


PROFILLER = {
    "onizleme": p_onizleme,
    "hizli": p_hizli,
    "final": p_final,
    "sinematik": p_sinematik,
}


# ------------------------------------------------------------------- çıktılar
# Video yerine hep GÖRÜNTÜ DİZİSİ: çökme/aşırı ısınmada yalnızca son kare
# kaybolur. Videoya çevirmek için: cgi/kodla.ps1

def cikti_png(scene):
    im = scene.render.image_settings
    ayarla(im, "media_type", "IMAGE")
    im.file_format = "PNG"
    ayarla(im, "color_mode", "RGB")
    ayarla(im, "color_depth", "16")
    ayarla(im, "compression", 15)          # hızlı yazım, biraz daha büyük dosya


def cikti_exr(scene):
    im = scene.render.image_settings
    if not ayarla(im, "media_type", "MULTI_LAYER_IMAGE"):
        im.file_format = "OPEN_EXR_MULTILAYER"
    else:
        ayarla(im, "file_format", "OPEN_EXR_MULTILAYER")
    ayarla(im, "color_depth", "16")       # half float: renk için yeterli
    ayarla(im, "exr_codec", "DWAA")       # küçük + hızlı, kurgu için uygun


# ---------------------------------------------------------------------- ana

def uygula(profil="final", vram=None, cikti=None, scene=None):
    scene = scene or bpy.context.scene
    ad, okunan = gpu_bilgisi()
    vram = vram if vram is not None else okunan
    kademe = vram_kademesi(vram)
    log(f"GPU={ad or 'bilinmiyor'} VRAM={vram or '?'}GB → "
        f"doku sınırı {kademe['doku']}, karo {kademe['karo']}")
    tur = gpu_hazirla()
    ortak(scene, kademe)
    PROFILLER[profil](scene, kademe, tur)
    if cikti:
        scene.render.filepath = (cikti if cikti.endswith("_")
                                 else os.path.join(cikti, "kare_"))
    else:
        scene.render.filepath = f"//render/{profil}/kare_"
    log(f"profil '{profil}' uygulandı → {scene.render.filepath}")
    return kademe


def main():
    a = argumanlar(sys.argv)
    uygula(a["profil"], a["vram"], a["cikti"])
    if a["kaydet"] and bpy.data.filepath:
        bpy.ops.wm.save_mainfile()
        log("kaydedildi")
    if a["kare"] is not None:
        bpy.context.scene.frame_set(a["kare"])
        bpy.ops.render.render(write_still=True)
    elif a["render"]:
        bpy.ops.render.render(animation=True)


if __name__ == "__main__":
    main()
