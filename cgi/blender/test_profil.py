"""g870_profil.py testleri. Gereksinim: `pip install bpy` (ya da Blender içinden:
blender -b -P cgi/blender/test_profil.py).

Her profili uygular, beklenen ayarları doğrular, Cycles profillerinde küçük
bir kare render eder ve hiçbir ayarın "atlandı" diye düşmediğini kontrol eder.
"""
import contextlib
import io
import os
import runpy
import sys
import tempfile

import bpy

BURASI = os.path.dirname(os.path.abspath(__file__))
m = runpy.run_path(os.path.join(BURASI, "g870_profil.py"), run_name="g870")

hata = 0


def bekle(kosul, mesaj):
    global hata
    print(("  ✔ " if kosul else "  ✖ ") + mesaj)
    if not kosul:
        hata += 1


# VRAM kademeleri
bekle(m["vram_kademesi"](6)["doku"] == "2048", "6 GB → 2K doku")
bekle(m["vram_kademesi"](8)["doku"] == "4096", "8 GB → 4K doku")
bekle(m["vram_kademesi"](12)["doku"] == "OFF", "12 GB → sınırsız")
bekle(m["vram_kademesi"](None)["doku"] == "4096", "bilinmiyor → 8 GB varsay")

# Argümanlar
a = m["argumanlar"](["blender", "--", "--profil", "hizli", "--vram", "6", "--render"])
bekle(a["profil"] == "hizli" and a["vram"] == 6.0 and a["render"], "argümanlar çözülüyor")

beklenen = {
    "onizleme": ("CYCLES", "PNG", 32),
    "hizli": (None, "PNG", None),
    "final": ("CYCLES", "PNG", 1024),
    "sinematik": ("CYCLES", "OPEN_EXR_MULTILAYER", 512),
}

with tempfile.TemporaryDirectory() as tmp:
    for profil, (motor, bicim, ornek) in beklenen.items():
        print(f"\n{profil}")
        bpy.ops.wm.read_factory_settings(use_empty=False)
        s = bpy.context.scene
        kayit = io.StringIO()
        with contextlib.redirect_stdout(kayit):
            m["uygula"](profil, vram=6, cikti=os.path.join(tmp, profil))
        bekle("atlandı" not in kayit.getvalue(),
              "tüm ayarlar uygulandı" + ("" if "atlandı" not in kayit.getvalue()
                                         else ":\n" + kayit.getvalue()))
        if motor:
            bekle(s.render.engine == motor, f"motor {motor}")
            bekle(s.cycles.samples == ornek, f"{ornek} örnek")
            bekle(s.cycles.texture_limit_render == "2048", "6 GB doku sınırı")
        else:
            bekle(s.render.engine.startswith("BLENDER_EEVEE"), "motor EEVEE")
        bekle(s.render.image_settings.file_format == bicim, f"çıktı {bicim}")
        bekle(s.view_settings.view_transform == "AgX", "AgX")
        bekle(not s.render.use_overwrite and s.render.use_placeholder,
              "kaldığı yerden devam")

        if motor == "CYCLES":  # EEVEE GPU/OpenGL ister; CI'da render etme
            s.render.resolution_x, s.render.resolution_y = 64, 36
            s.cycles.samples = 2
            s.frame_start = s.frame_end = 1
            bpy.ops.render.render(animation=True)
            uz = ".exr" if "EXR" in bicim else ".png"
            bekle(os.path.exists(os.path.join(tmp, profil, "kare_0001" + uz)),
                  f"kare_0001{uz} yazıldı")

print("\n✔ HEPSİ GEÇTİ" if hata == 0 else f"\n✖ {hata} BAŞARISIZ")
sys.exit(1 if hata else 0)
