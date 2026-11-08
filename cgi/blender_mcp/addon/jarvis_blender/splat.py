"""3D Gaussian Splatting (3DGS) içe aktarıcı.

Desteklenen biçimler:
    .ply    Standart 3DGS çıktısı (Inria, gsplat/nerfstudio, Brush, Postshot,
            Luma, Polycam, KIRI, SuperSplat "uncompressed" dışa aktarımı).
    .splat  antimatter15 biçimi (32 bayt/splat).

Blender'da gerçek 3DGS rasterizasyonu yoktur. Her splat, Geometry Nodes ile
yönelimli ve ölçeklenmiş küçük bir elipsoid örneği (instance) olarak çizilir;
materyal, kenarlara doğru Gauss düşüşüyle saydamlaşan ışıyan (emission) renk
kullanır. Sonuç Cycles ve EEVEE'de render edilir, kamera hareketi/derinlik
alanı/hareket bulanıklığı alır ve normal 3B nesnelerle aynı sahnede durur.

Bellek: 1 milyon splat ≈ 8 GB VRAM'de rahat. Fazlası önem sırasına göre
(opaklık × görünür alan) ayıklanır.
"""

import math
import os

import numpy as np

import bpy

C0 = 0.28209479177387814  # 0. derece küresel harmonik katsayısı

_PLY_TIP = {
    "float": "<f4", "float32": "<f4", "double": "<f8", "float64": "<f8",
    "uchar": "u1", "uint8": "u1", "char": "i1", "int8": "i1",
    "short": "<i2", "int16": "<i2", "ushort": "<u2", "uint16": "<u2",
    "int": "<i4", "int32": "<i4", "uint": "<u4", "uint32": "<u4",
}


# ----------------------------------------------------------------- okuma

def _ply_oku(yol):
    with open(yol, "rb") as f:
        if f.readline().strip() != b"ply":
            raise ValueError("PLY dosyası değil")
        bicim, elemanlar, simdiki = None, [], None
        while True:
            satir = f.readline()
            if not satir:
                raise ValueError("PLY başlığı bitmedi")
            p = satir.decode("ascii", "replace").split()
            if not p:
                continue
            if p[0] == "format":
                bicim = p[1]
            elif p[0] == "element":
                simdiki = [p[1], int(p[2]), []]
                elemanlar.append(simdiki)
            elif p[0] == "property":
                if p[1] == "list":
                    raise ValueError("liste özellikli PLY (mesh yüzleri) splat değil")
                simdiki[2].append((p[2], _PLY_TIP[p[1]]))
            elif p[0] == "end_header":
                break
        if bicim != "binary_little_endian":
            raise ValueError(f"desteklenmeyen PLY biçimi: {bicim} (binary_little_endian gerekli)")
        adlar = [e[0] for e in elemanlar]
        if "chunk" in adlar:
            raise ValueError("Sıkıştırılmış PLY (SuperSplat/PlayCanvas). SuperSplat'te "
                             "File → Export → 'Uncompressed PLY' ile dışa aktar.")
        veri = None
        for ad, n, ozellikler in elemanlar:
            dt = np.dtype(ozellikler)
            parca = np.frombuffer(f.read(n * dt.itemsize), dtype=dt, count=n)
            if ad == "vertex":
                veri = parca
                break
        if veri is None:
            raise ValueError("PLY'de 'vertex' elemanı yok")
        return veri


def _sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


def oku(yol):
    """Dosyayı oku → dict(konum, renk_srgb, opaklik, olcek, rot[w,x,y,z])."""
    uz = os.path.splitext(yol)[1].lower()
    if uz == ".splat":
        dt = np.dtype([("p", "<f4", 3), ("s", "<f4", 3), ("c", "u1", 4), ("r", "u1", 4)])
        v = np.fromfile(yol, dtype=dt)
        rot = (v["r"].astype(np.float32) - 128.0) / 128.0
        return {
            "konum": v["p"].astype(np.float32),
            "renk": v["c"][:, :3].astype(np.float32) / 255.0,
            "opaklik": v["c"][:, 3].astype(np.float32) / 255.0,
            "olcek": v["s"].astype(np.float32),
            "rot": rot,
        }
    if uz != ".ply":
        raise ValueError(f"desteklenmeyen uzantı: {uz} (.ply ya da .splat)")
    v = _ply_oku(yol)
    ad = set(v.dtype.names)
    konum = np.stack([v["x"], v["y"], v["z"]], 1).astype(np.float32)
    if {"f_dc_0", "opacity", "scale_0", "rot_0"} <= ad:
        dc = np.stack([v["f_dc_0"], v["f_dc_1"], v["f_dc_2"]], 1).astype(np.float32)
        return {
            "konum": konum,
            "renk": np.clip(0.5 + C0 * dc, 0.0, 1.0),
            "opaklik": _sigmoid(v["opacity"].astype(np.float32)),
            "olcek": np.exp(np.stack([v["scale_0"], v["scale_1"], v["scale_2"]], 1)).astype(np.float32),
            "rot": np.stack([v["rot_0"], v["rot_1"], v["rot_2"], v["rot_3"]], 1).astype(np.float32),
        }
    if {"red", "green", "blue"} <= ad:  # düz nokta bulutu → eşit küçük splatlar
        n = len(v)
        renk = np.stack([v["red"], v["green"], v["blue"]], 1).astype(np.float32)
        if renk.max() > 1.0:
            renk /= 255.0
        kutu = konum.max(0) - konum.min(0)
        r = float(np.cbrt(np.prod(np.maximum(kutu, 1e-6)) / max(n, 1))) * 0.5
        return {"konum": konum, "renk": renk, "opaklik": np.ones(n, np.float32),
                "olcek": np.full((n, 3), r, np.float32),
                "rot": np.tile(np.array([1, 0, 0, 0], np.float32), (n, 1))}
    raise ValueError("Bu PLY bir Gaussian splat ya da renkli nokta bulutu değil "
                     "(f_dc_0/opacity/scale_0/rot_0 ya da red/green/blue yok).")


def ayikla(d, max_nokta=1_000_000, min_opaklik=0.05, buyuk_kes=99.9):
    """Görünmeyen, dev 'floater' ve fazla splatları at. Kalan sayıyı döndür."""
    n0 = len(d["konum"])
    maske = d["opaklik"] >= min_opaklik
    maske &= np.isfinite(d["konum"]).all(1) & np.isfinite(d["olcek"]).all(1)
    enbuyuk = d["olcek"].max(1)
    if buyuk_kes and maske.any():
        esik = np.percentile(enbuyuk[maske], buyuk_kes) * 2.0
        maske &= enbuyuk <= esik
    idx = np.nonzero(maske)[0]
    if max_nokta and len(idx) > max_nokta:
        alan = np.prod(d["olcek"][idx], 1) ** (2.0 / 3.0)
        onem = d["opaklik"][idx] * alan
        idx = idx[np.argpartition(-onem, max_nokta - 1)[:max_nokta]]
        idx.sort()
    for k in d:
        d[k] = d[k][idx]
    q = d["rot"]
    d["rot"] = q / np.maximum(np.linalg.norm(q, axis=1, keepdims=True), 1e-8)
    return {"okunan": n0, "kalan": len(idx)}


def _srgb_lineer(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


# ----------------------------------------------------------------- sahne

def _dugum_grubu(ad, detay):
    ng = bpy.data.node_groups.new(ad, "GeometryNodeTree")
    ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    s = ng.interface.new_socket("Boyut", in_out="INPUT", socket_type="NodeSocketFloat")
    s.default_value, s.min_value, s.max_value = 3.0, 0.1, 6.0
    s.description = "Splat yarıçapı, sigma cinsinden (3 = gerçek 3DGS gibi 3σ'da kes)"
    N, L = ng.nodes, ng.links
    gi, go = N.new("NodeGroupInput"), N.new("NodeGroupOutput")
    ico = N.new("GeometryNodeMeshIcoSphere")
    ico.inputs["Radius"].default_value = 1.0
    ico.inputs["Subdivisions"].default_value = detay
    yum = N.new("GeometryNodeSetShadeSmooth")
    mat = N.new("GeometryNodeSetMaterial")
    mat.name = "Splat Materyal"
    iop = N.new("GeometryNodeInstanceOnPoints")
    rot = N.new("GeometryNodeInputNamedAttribute")
    rot.data_type, rot.inputs["Name"].default_value = "QUATERNION", "splat_rot"
    olc = N.new("GeometryNodeInputNamedAttribute")
    olc.data_type, olc.inputs["Name"].default_value = "FLOAT_VECTOR", "splat_olcek"
    carp = N.new("ShaderNodeVectorMath")
    carp.operation = "SCALE"
    L.new(gi.outputs["Geometry"], iop.inputs["Points"])
    L.new(ico.outputs["Mesh"], yum.inputs["Mesh"])
    L.new(yum.outputs["Mesh"], mat.inputs["Geometry"])
    L.new(mat.outputs["Geometry"], iop.inputs["Instance"])
    L.new(rot.outputs["Attribute"], iop.inputs["Rotation"])
    L.new(olc.outputs["Attribute"], carp.inputs[0])
    L.new(gi.outputs["Boyut"], carp.inputs["Scale"])
    L.new(carp.outputs["Vector"], iop.inputs["Scale"])
    L.new(iop.outputs["Instances"], go.inputs["Geometry"])
    return ng, mat


def _materyal(ad, boyut):
    m = bpy.data.materials.new(ad)
    if m.node_tree is None:
        m.use_nodes = True
    N, L = m.node_tree.nodes, m.node_tree.links
    N.clear()
    cikis = N.new("ShaderNodeOutputMaterial")
    renk = N.new("ShaderNodeAttribute")
    renk.attribute_type, renk.attribute_name = "INSTANCER", "splat_renk"
    opak = N.new("ShaderNodeAttribute")
    opak.attribute_type, opak.attribute_name = "INSTANCER", "splat_opaklik"
    isik = N.new("ShaderNodeEmission")
    isik.name = "Parlaklik"
    seffaf = N.new("ShaderNodeBsdfTransparent")
    karis = N.new("ShaderNodeMixShader")
    katman = N.new("ShaderNodeLayerWeight")
    katman.inputs["Blend"].default_value = 0.5
    yay = N.new("ShaderNodeValue")
    yay.name = yay.label = "Boyut"
    yay.outputs[0].default_value = boyut

    def islem(op, a, b=None):
        n = N.new("ShaderNodeMath")
        n.operation = op
        for i, g in enumerate((a, b)):
            if g is None:
                continue
            if isinstance(g, (int, float)):
                n.inputs[i].default_value = g
            else:
                L.new(g, n.inputs[i])
        return n.outputs[0]

    # Birim küre üzerinde: d = |N·V| ≈ 1 - facing,  izdüşüm yarıçapı r² = 1 - d²
    # alfa = opaklık · exp(-½ · (Boyut · r)²)   → gerçek Gauss düşüşü
    d = islem("SUBTRACT", 1.0, katman.outputs["Facing"])
    r2 = islem("SUBTRACT", 1.0, islem("MULTIPLY", d, d))
    k2 = islem("MULTIPLY", yay.outputs[0], yay.outputs[0])
    us = islem("MULTIPLY", islem("MULTIPLY", r2, k2), -0.5)
    alfa = islem("MULTIPLY", islem("EXPONENT", us), opak.outputs["Fac"])
    L.new(renk.outputs["Color"], isik.inputs["Color"])
    L.new(alfa, karis.inputs["Fac"])
    L.new(seffaf.outputs[0], karis.inputs[1])
    L.new(isik.outputs[0], karis.inputs[2])
    L.new(karis.outputs[0], cikis.inputs["Surface"])
    if hasattr(m, "surface_render_method"):
        m.surface_render_method = "DITHERED"   # EEVEE: örnek başına doğru sıralama
    return m


_YUKARI = {"Z": 0.0, "Y": 90.0, "-Y": -90.0, "-Z": 180.0}


def ice_aktar(yol, ad=None, max_nokta=1_000_000, min_opaklik=0.05, yukari="-Y",
              konum=(0.0, 0.0, 0.0), olcek=1.0, boyut=3.0, detay=2, koleksiyon=None):
    """Splat dosyasını sahneye ekle. Döndürür: özet dict."""
    yol = bpy.path.abspath(yol)
    if not os.path.isfile(yol):
        raise FileNotFoundError(yol)
    if yukari not in _YUKARI:
        raise ValueError(f"yukari şunlardan biri olmalı: {list(_YUKARI)}")
    d = oku(yol)
    sayim = ayikla(d, max_nokta, min_opaklik)
    n = sayim["kalan"]
    if n == 0:
        raise ValueError("ayıklamadan sonra splat kalmadı; min_opaklik'i düşür")
    ad = ad or os.path.splitext(os.path.basename(yol))[0]

    me = bpy.data.meshes.new(ad)
    me.vertices.add(n)
    me.vertices.foreach_set("co", d["konum"].ravel())
    renk = np.ones((n, 4), np.float32)
    renk[:, :3] = _srgb_lineer(d["renk"])
    me.attributes.new("splat_renk", "FLOAT_COLOR", "POINT").data.foreach_set("color", renk.ravel())
    me.attributes.new("splat_opaklik", "FLOAT", "POINT").data.foreach_set("value", d["opaklik"])
    me.attributes.new("splat_olcek", "FLOAT_VECTOR", "POINT").data.foreach_set("vector", d["olcek"].ravel())
    me.attributes.new("splat_rot", "QUATERNION", "POINT").data.foreach_set("value", d["rot"].ravel())
    me.update()

    ob = bpy.data.objects.new(ad, me)
    (koleksiyon or bpy.context.scene.collection).objects.link(ob)
    ob.location = konum
    ob.rotation_euler = (math.radians(_YUKARI[yukari]), 0.0, 0.0)
    ob.scale = (olcek,) * 3
    ob["jarvis_splat"] = True

    ng, mat_dugum = _dugum_grubu(f"{ad}_Splat", detay)
    mat = _materyal(f"{ad}_Splat", boyut)
    mat_dugum.inputs["Material"].default_value = mat
    mod = ob.modifiers.new("Gaussian Splat", "NODES")
    mod.node_group = ng
    _boyut_ayarla(ob, boyut)
    ob.data.materials.append(mat)

    sc = bpy.context.scene
    # Üst üste binen yarı saydam katmanlar için yeterli saydamlık sekmesi.
    if hasattr(sc, "cycles") and sc.cycles.transparent_max_bounces < 64:
        sc.cycles.transparent_max_bounces = 64

    kutu = d["konum"].max(0) - d["konum"].min(0)
    return {"nesne": ob.name, "okunan": sayim["okunan"], "kullanilan": n,
            "boyutlar_m": [round(float(x) * olcek, 3) for x in kutu],
            "not": ("Splat renkleri fotoğraftaki ışığı taşır; sahne ışıkları splatları "
                    "etkilemez. En doğru renk için set_color_look('standart').")}


def _boyut_ayarla(ob, boyut):
    mod = ob.modifiers.get("Gaussian Splat")
    if mod is None:
        raise ValueError(f"{ob.name} bir Jarvis splat nesnesi değil")
    soket = next(i for i in mod.node_group.interface.items_tree
                 if getattr(i, "in_out", "") == "INPUT" and i.name == "Boyut")
    girdiler = getattr(getattr(mod, "properties", None), "inputs", None)
    if girdiler is not None and hasattr(girdiler, soket.identifier):   # Blender 5.x
        getattr(girdiler, soket.identifier).value = float(boyut)
    else:                                                               # 4.x
        mod[soket.identifier] = float(boyut)
    for m in ob.data.materials:
        if m and m.node_tree and "Boyut" in m.node_tree.nodes:
            m.node_tree.nodes["Boyut"].outputs[0].default_value = float(boyut)


def ayarla(ob, boyut=None, parlaklik=None, gorunur_viewport=None):
    if boyut is not None:
        _boyut_ayarla(ob, boyut)
    if parlaklik is not None:
        for m in ob.data.materials:
            if m and m.node_tree and "Parlaklik" in m.node_tree.nodes:
                m.node_tree.nodes["Parlaklik"].inputs["Strength"].default_value = float(parlaklik)
    if gorunur_viewport is not None:
        # Ağır sahnede viewport'ta gizle, render'da göster.
        ob.modifiers["Gaussian Splat"].show_viewport = bool(gorunur_viewport)
    return {"nesne": ob.name}
