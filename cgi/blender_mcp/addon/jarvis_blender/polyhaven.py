"""Poly Haven (polyhaven.com) — ücretsiz, CC0 lisanslı HDRI, model ve dokular.

Fotogerçekçiliğin en ucuz yolu: gerçek ışık (HDRI) + taranmış modeller +
fotogrametrik dokular. Telif yok, ticari işte serbest.
"""

import json
import os
import urllib.parse
import urllib.request

import bpy

API = "https://api.polyhaven.com"
UA = {"User-Agent": "JarvisBlenderMCP/1.0 (+https://github.com/eysox7/Jarvis-thing)"}
TURLER = {"hdris": "hdris", "hdri": "hdris", "models": "models", "model": "models",
          "textures": "textures", "texture": "textures"}


def _al(url, zaman=30):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=zaman) as r:
        return r.read()


def _json(yol):
    return json.loads(_al(API + yol))


def onbellek():
    kok = os.environ.get("JARVIS_ONBELLEK") or os.path.join(
        bpy.utils.user_resource("DATAFILES"), "jarvis_polyhaven")
    os.makedirs(kok, exist_ok=True)
    return kok


def _indir(url, hedef):
    if os.path.isfile(hedef) and os.path.getsize(hedef) > 0:
        return hedef
    os.makedirs(os.path.dirname(hedef), exist_ok=True)
    gecici = hedef + ".part"
    with open(gecici, "wb") as f:
        f.write(_al(url, zaman=300))
    os.replace(gecici, hedef)
    return hedef


def ara(tur="hdris", sorgu="", kategori=None, limit=20):
    tur = TURLER.get(tur, tur)
    yol = f"/assets?t={tur}"
    if kategori:
        yol += "&categories=" + urllib.parse.quote(kategori)
    varliklar = _json(yol)
    s = (sorgu or "").lower().split()
    sonuc = []
    for vid, v in varliklar.items():
        metin = " ".join([vid, v.get("name", "")] + v.get("tags", []) + v.get("categories", [])).lower()
        if all(k in metin for k in s):
            sonuc.append({"id": vid, "ad": v.get("name"), "kategoriler": v.get("categories", []),
                          "etiketler": v.get("tags", [])[:8], "indirme": v.get("download_count", 0)})
    sonuc.sort(key=lambda x: -x["indirme"])
    return {"toplam": len(sonuc), "sonuclar": sonuc[:limit]}


def kategoriler(tur="hdris"):
    return _json(f"/categories/{TURLER.get(tur, tur)}")


def _cozunurluk(secenekler, istenen):
    """İstenen yoksa bir alt çözünürlük, o da yoksa mevcut ilk."""
    if istenen in secenekler:
        return istenen
    sira = ["1k", "2k", "4k", "8k", "16k"]
    i = sira.index(istenen) if istenen in sira else 1
    for c in list(reversed(sira[:i])) + sira:
        if c in secenekler:
            return c
    return next(iter(secenekler))


def hdri_indir(vid, cozunurluk="2k"):
    d = _json(f"/files/{vid}")["hdri"]
    c = _cozunurluk(d, cozunurluk)
    bilgi = d[c].get("exr") or d[c]["hdr"]
    yol = os.path.join(onbellek(), "hdri", os.path.basename(urllib.parse.urlparse(bilgi["url"]).path))
    return _indir(bilgi["url"], yol)


def model_indir(vid, cozunurluk="1k"):
    d = _json(f"/files/{vid}")["gltf"]
    c = _cozunurluk(d, cozunurluk)
    g = d[c]["gltf"]
    kok = os.path.join(onbellek(), "model", vid, c)
    ana = _indir(g["url"], os.path.join(kok, os.path.basename(urllib.parse.urlparse(g["url"]).path)))
    for goreli, bilgi in g.get("include", {}).items():
        _indir(bilgi["url"], os.path.join(kok, *goreli.split("/")))
    return ana


_DOKU_HARITA = {  # Poly Haven anahtarı → (Principled girişi, renk uzayı)
    "Diffuse": ("Base Color", "sRGB"),
    "Rough": ("Roughness", "Non-Color"),
    "Metal": ("Metallic", "Non-Color"),
    "nor_gl": ("Normal", "Non-Color"),
    "Displacement": ("Displacement", "Non-Color"),
}


def doku_indir(vid, cozunurluk="2k"):
    d = _json(f"/files/{vid}")
    yollar = {}
    for anahtar in _DOKU_HARITA:
        if anahtar not in d:
            continue
        c = _cozunurluk(d[anahtar], cozunurluk)
        bicimler = d[anahtar][c]
        b = bicimler.get("jpg") or bicimler.get("png") or next(iter(bicimler.values()))
        yollar[anahtar] = _indir(b["url"], os.path.join(onbellek(), "doku", vid, c,
                                                       os.path.basename(urllib.parse.urlparse(b["url"]).path)))
    if not yollar:
        raise ValueError(f"{vid} için doku haritası bulunamadı")
    return yollar


def doku_materyali(vid, yollar, olcek=1.0):
    m = bpy.data.materials.new(f"PH_{vid}")
    if m.node_tree is None:
        m.use_nodes = True
    N, L = m.node_tree.nodes, m.node_tree.links
    p = N.get("Principled BSDF") or N.new("ShaderNodeBsdfPrincipled")
    cikis = N.get("Material Output") or N.new("ShaderNodeOutputMaterial")
    koord = N.new("ShaderNodeTexCoord")
    harita = N.new("ShaderNodeMapping")
    harita.inputs["Scale"].default_value = (olcek, olcek, olcek)
    L.new(koord.outputs["UV"], harita.inputs["Vector"])
    for anahtar, yol in yollar.items():
        giris, uzay = _DOKU_HARITA[anahtar]
        t = N.new("ShaderNodeTexImage")
        t.image = bpy.data.images.load(yol, check_existing=True)
        t.image.colorspace_settings.name = uzay
        L.new(harita.outputs["Vector"], t.inputs["Vector"])
        if giris == "Normal":
            nm = N.new("ShaderNodeNormalMap")
            L.new(t.outputs["Color"], nm.inputs["Color"])
            L.new(nm.outputs["Normal"], p.inputs["Normal"])
        elif giris == "Displacement":
            dp = N.new("ShaderNodeDisplacement")
            dp.inputs["Scale"].default_value = 0.05
            L.new(t.outputs["Color"], dp.inputs["Height"])
            L.new(dp.outputs["Displacement"], cikis.inputs["Displacement"])
        else:
            L.new(t.outputs["Color"], p.inputs[giris])
    return m
