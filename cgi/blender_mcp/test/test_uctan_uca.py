"""Uçtan uca test: MCP istemcisi → MCP sunucusu → Blender eklentisi (arayüzsüz).

Gereksinim (aynı Python'da):  pip install bpy mcp numpy
Çalıştır:                       python cgi/blender_mcp/test/test_uctan_uca.py
Ağ yoksa Poly Haven adımları atlanır (JARVIS_TEST_AG=0 ile de atlanır).
"""

import asyncio
import json
import os
import socket
import subprocess
import sys
import tempfile
import time

import numpy as np
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EKLENTI = os.path.join(KOK, "addon")
SUNUCU = os.path.join(KOK, "sunucu", "jarvis_blender_mcp.py")
hata = 0


def bekle(kosul, mesaj):
    global hata
    print(("  ✔ " if kosul else "  ✖ ") + mesaj, flush=True)
    hata += 0 if kosul else 1


def bos_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def splat_ply_yaz(yol, n=3000, renk=(0.9, 0.1, 0.1)):
    """Yarıçapı 1 m olan küre kabuğu şeklinde sentetik 3DGS dosyası (Inria biçimi)."""
    rng = np.random.default_rng(0)
    v = rng.normal(size=(n, 3)).astype(np.float32)
    v /= np.linalg.norm(v, axis=1, keepdims=True)
    alanlar = (["x", "y", "z", "nx", "ny", "nz", "f_dc_0", "f_dc_1", "f_dc_2"]
               + [f"f_rest_{i}" for i in range(45)]
               + ["opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"])
    d = np.zeros(n, dtype=[(a, "<f4") for a in alanlar])
    d["x"], d["y"], d["z"] = v[:, 0], v[:, 1], v[:, 2]
    dc = (np.array(renk) - 0.5) / 0.28209479177387814
    d["f_dc_0"], d["f_dc_1"], d["f_dc_2"] = dc
    d["opacity"] = 4.0                      # sigmoid → 0.98
    d["opacity"][:100] = -8.0               # görünmez: ayıklanmalı
    d["scale_0"] = d["scale_1"] = d["scale_2"] = np.log(0.06)
    d["rot_0"] = 1.0
    with open(yol, "wb") as f:
        f.write(f"ply\nformat binary_little_endian 1.0\nelement vertex {n}\n".encode())
        for a in alanlar:
            f.write(f"property float {a}\n".encode())
        f.write(b"end_header\n")
        f.write(d.tobytes())


def splat_dosya_yaz(yol, n=500):
    dt = np.dtype([("p", "<f4", 3), ("s", "<f4", 3), ("c", "u1", 4), ("r", "u1", 4)])
    d = np.zeros(n, dt)
    d["p"] = np.random.default_rng(1).uniform(-1, 1, (n, 3))
    d["s"] = 0.05
    d["c"] = (30, 200, 60, 255)
    d["r"] = (255, 128, 128, 128)
    d.tofile(yol)


def alan(nesne, *adlar):
    """MCP SDK 1.x camelCase / 2.x snake_case alan adları."""
    for a in adlar:
        if hasattr(nesne, a):
            return getattr(nesne, a)
    return None


def ag_var():
    if os.environ.get("JARVIS_TEST_AG") == "0":
        return False
    try:
        import urllib.request
        urllib.request.urlopen(urllib.request.Request(  # varsayılan UA'yı Poly Haven reddeder
            "https://api.polyhaven.com/types", headers={"User-Agent": "JarvisBlenderMCP-test"}), timeout=8)
        return True
    except Exception:
        return False


async def calistir(port, tmp):
    ortam = dict(os.environ, JARVIS_BLENDER_PORT=str(port))
    param = StdioServerParameters(command=sys.executable, args=[SUNUCU], env=ortam)
    async with stdio_client(param) as (oku, yaz), ClientSession(oku, yaz) as s:
        await s.initialize()

        async def cagir(ad, **kw):
            r = await s.call_tool(ad, kw)
            metin = [c.text for c in r.content if c.type == "text"]
            resim = [c for c in r.content if c.type == "image"]
            if alan(r, "is_error", "isError"):
                raise AssertionError(f"{ad}: {metin}")
            yapisal = alan(r, "structured_content", "structuredContent")
            veri = yapisal.get("result", yapisal) if yapisal else None
            if veri is None and metin:
                try:
                    veri = json.loads(metin[0])
                except json.JSONDecodeError:
                    veri = metin[0]
            return veri, resim

        araclar = {t.name for t in (await s.list_tools()).tools}
        print(f"\nMCP araçları ({len(araclar)})")
        bekle({"render_image", "import_gaussian_splat", "camera_move", "polyhaven_download"} <= araclar,
              "temel araçlar listede")
        bekle(len((await s.list_prompts()).prompts) >= 1, "sinematik_cekim istemi var")

        print("\nSahne")
        v, _ = await cagir("clear_scene")
        bekle(v["silinen"] >= 1, "varsayılan sahne temizlendi")
        await cagir("set_render_format", preset="cinema_239", fps=24, duration_seconds=2)
        v, _ = await cagir("get_scene_info")
        bekle(v["cozunurluk"][:2] == [1920, 804] and v["kare_araligi"] == [1, 48], "2.39:1, 48 kare")

        await cagir("create_object", type="plane", name="Zemin", size=20)
        await cagir("set_material", object="Zemin", preset="beton")
        v, _ = await cagir("create_object", type="cube", name="Kutu", location=[2.5, 0, 0.5], bevel=0.02)
        bekle(v["ad"] == "Kutu" and v["boyut"] == [1.0, 1.0, 1.0], "pahlı küp 1 m")
        v, _ = await cagir("set_material", object="Kutu", preset="altin")
        bekle(v["materyal"].startswith("Kutu"), "altın materyal")
        for tur in ("sphere", "torus", "text", "monkey", "cone"):
            v, _ = await cagir("create_object", type=tur, name=f"T_{tur}", location=[0, 8, 0], text="JARVIS")
        await cagir("delete_objects", names=[f"T_{t}" for t in ("sphere", "torus", "text", "monkey", "cone")])
        v, _ = await cagir("duplicate_object", name="Kutu", new_name="Kutu2", location=[-2.5, 0, 0.5])
        bekle(v["konum"] == [-2.5, 0.0, 0.5], "bağlı kopya")
        v, _ = await cagir("transform_object", name="Kutu2", rotation=[0, 0, 45])
        bekle(abs(v["rotasyon"][2] - 45) < 0.01, "döndürme derece cinsinden")

        print("\nGaussian splat")
        ply = os.path.join(tmp, "kure.ply")
        splat_ply_yaz(ply)
        v, _ = await cagir("import_gaussian_splat", path=ply, name="Kure", up_axis="Z",
                           location=[0, 0, 1.2])
        bekle(v["okunan"] == 3000 and v["kullanilan"] == 2900, "görünmez 100 splat ayıklandı")
        bekle(all(abs(x - 2.0) < 0.05 for x in v["boyutlar_m"]), "boyut 2 m")
        v, _ = await cagir("import_gaussian_splat", path=ply, name="Kucuk", max_points=500, up_axis="Z",
                           location=[0, 30, 0])
        bekle(v["kullanilan"] == 500, "max_points sınırı")
        await cagir("delete_objects", names=["Kucuk"])
        sp = os.path.join(tmp, "nokta.splat")
        splat_dosya_yaz(sp)
        v, _ = await cagir("import_model", path=sp, name="Yesil")
        bekle(v.get("kullanilan") == 500, ".splat biçimi import_model ile")
        await cagir("delete_objects", names=["Yesil"])
        v, _ = await cagir("tune_splat", name="Kure", splat_size=2.5, brightness=1.0)
        bekle(v["nesne"] == "Kure", "tune_splat")

        print("\nIşık / kamera / görünüm")
        v, _ = await cagir("lighting_preset", preset="three_point", target="Kure")
        bekle(len(v["isiklar"]) == 3, "üç nokta ışık")
        for p in ("golden_hour", "studio", "noir", "neon", "moonlight", "overcast"):
            await cagir("lighting_preset", preset=p)
        await cagir("lighting_preset", preset="studio", target="Kure")
        v, _ = await cagir("add_atmosphere", density=0.01)
        bekle(v["atmosfer"], "atmosfer eklendi")
        await cagir("add_atmosphere", remove=True)
        v, _ = await cagir("setup_camera", target="Kure", focal_length=50, fstop=2.8)
        bekle(v["lens_mm"] == 50 and v["f_stop"] == 2.8, "kamera + alan derinliği")
        for m in ("orbit", "truck", "crane_up", "flyover", "reveal", "pull_out"):
            await cagir("camera_move", move=m, target="Kure")
        v, _ = await cagir("camera_move", move="push_in", target="Kure", shake=0.03)
        bekle(v["kareler"] == [1, 48] and v["anahtar_kare"] == 2, "push_in 48 kare")
        v, _ = await cagir("execute_python", code=(
            "ob=D.objects['Kamera']; ad=ob.animation_data\n"
            "from bpy_extras import anim_utils\n"
            "cb=anim_utils.action_get_channelbag_for_slot(ad.action, ad.action_slot)\n"
            "sonuc=[len(f.modifiers) for f in cb.fcurves]\n"
            "C.scene.frame_set(1); a=ob.matrix_world.translation.copy()\n"
            "C.scene.frame_set(48); b=ob.matrix_world.translation.copy()\n"
            "print(round((a-b).length,2))"))
        bekle(v["sonuc"] == [1, 1, 1] and float(v["cikti"]) > 0.5, "anahtar kareler + el titremesi")
        v, _ = await cagir("set_color_look", look="cinema", motion_blur=True)
        bekle(v["donusum"] == "AgX" and v["hareket_bulanikligi"], "AgX + hareket bulanıklığı")
        await cagir("set_color_look", look="standard")

        print("\nRender")
        v, _ = await cagir("apply_render_profile", profile="onizleme")
        bekle(v["motor"] == "CYCLES", "önizleme profili (Cycles)")
        v, resim = await cagir("render_image", resolution_percentage=12, samples=8, frame=1)
        bekle(os.path.isfile(v["dosya"]) and len(resim) == 1 and alan(resim[0], "mime_type", "mimeType") == "image/jpeg",
              f"render + JPEG önizleme ({v['sure_sn']} sn)")
        async def merkez_rengi(yol):
            kod = (f"im=D.images.load(r'{yol}'); import numpy as np\n"
                   "p=np.array(im.pixels[:]).reshape(-1,4); w,h=im.size\n"
                   "p=p.reshape(h,w,4)[h//3:2*h//3, w//3:2*w//3, :3].reshape(-1,3)\n"
                   "sonuc=[round(float(x),3) for x in p.mean(0)]")
            return (await cagir("execute_python", code=kod))[0]["sonuc"]

        ile = await merkez_rengi(v["dosya"])
        await cagir("execute_python", code="D.objects['Kure'].hide_render=True")
        v2, _ = await cagir("render_image", resolution_percentage=12, samples=8, frame=1)
        await cagir("execute_python", code="D.objects['Kure'].hide_render=False")
        siz = await merkez_rengi(v2["dosya"])
        kirmizi_artis = (ile[0] - siz[0]) - max(ile[1] - siz[1], ile[2] - siz[2])
        bekle(kirmizi_artis > 0.15 and ile[0] > max(ile[1], ile[2]),
              f"kırmızı splat küre kadrajda: splatlı {ile} / splatsız {siz}")
        v, _ = await cagir("get_scene_info")
        bekle(v["cozunurluk"][2] == 50, "render_image kalıcı ayarı bozmadı")

        blend = os.path.join(tmp, "proje", "sahne.blend")
        v, _ = await cagir("save_file", path=blend)
        bekle(os.path.isfile(blend), "kaydedildi")
        await cagir("execute_python", code="C.scene.render.resolution_percentage=5; C.scene.cycles.samples=2")
        v, _ = await cagir("render_animation", profile="onizleme", frame_start=1, frame_end=2)
        is_no = v["is"]
        for _ in range(240):
            d, _ = await cagir("job_status", job=is_no)
            if d["durum"] != "suruyor":
                break
            time.sleep(1)
        bekle(d["durum"] == "bitti" and d["kare"].startswith("2/"), f"arka plan animasyon render: {d['durum']} {d['kare']}")

        if ag_var():
            print("\nPoly Haven")
            v, _ = await cagir("polyhaven_search", asset_type="hdris", query="studio", limit=3)
            bekle(v["toplam"] > 0, f"HDRI arama: {[x['id'] for x in v['sonuclar']]}")
            v, _ = await cagir("polyhaven_download", asset_id=v["sonuclar"][0]["id"], asset_type="hdris",
                               resolution="1k")
            bekle(os.path.isfile(v["hdri"]), "HDRI indirildi ve uygulandı")
            v, _ = await cagir("polyhaven_download", asset_id="wooden_table_02", asset_type="models",
                               resolution="1k", location=[0, -3, 0])
            bekle(len(v["eklenen"]) >= 1, f"model eklendi: {v['kok']}")
            v, _ = await cagir("polyhaven_download", asset_id="concrete_floor_02", asset_type="textures",
                               resolution="1k", apply_to="Zemin", texture_scale=4)
            bekle("Diffuse" in v["haritalar"], f"PBR doku: {v['haritalar']}")
        else:
            print("\nPoly Haven: ağ yok, atlandı")

        print("\nHata yönetimi")
        r = await s.call_tool("get_object_info", {"name": "YokBoyleBirSey"})
        bekle(alan(r, "is_error", "isError") and "nesne yok" in r.content[0].text, "olmayan nesne → anlaşılır hata")
        v, _ = await cagir("ping") if "ping" in araclar else ({"blender": "-"}, None)


async def ana():
    port = bos_port()
    with tempfile.TemporaryDirectory() as tmp:
        ortam = dict(os.environ, JARVIS_BLENDER_PORT=str(port), JARVIS_ONBELLEK=os.path.join(tmp, "onbellek"))
        blender = subprocess.Popen(
            [sys.executable, "-c",
             f"import sys; sys.path.insert(0, {EKLENTI!r}); import jarvis_blender as j; j.calistir_bloklayan()"],
            env=ortam, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        try:
            for satir in blender.stdout:
                if "dinliyor" in satir:
                    break
            threading_log(blender)
            await calistir(port, tmp)
        finally:
            with socket.create_connection(("127.0.0.1", port), timeout=5) as k:
                k.sendall(b'{"id":0,"komut":"shutdown"}\n')
                k.recv(100)
            blender.wait(timeout=30)
    print("\n✔ HEPSİ GEÇTİ" if hata == 0 else f"\n✖ {hata} BAŞARISIZ")
    sys.exit(1 if hata else 0)


def threading_log(p):
    """Blender çıktısını boşalt (boru dolup süreci kilitlemesin)."""
    import threading
    threading.Thread(target=lambda: [None for _ in p.stdout], daemon=True).start()


if __name__ == "__main__":
    asyncio.run(ana())
