"""MCP'nin çağırdığı komutlar. Her fonksiyon JSON'a çevrilebilir bir değer döndürür.

Birimler: uzunluk metre, açı derece, renk "#rrggbb" ya da [r, g, b] (0-1, sRGB).
"""

import contextlib
import importlib.util
import io
import math
import os
import subprocess
import sys
import tempfile
import time

import bpy
import bmesh
from mathutils import Euler, Vector

from . import polyhaven, splat


# ============================================================ yardımcılar

def _r(v, n=3):
    return [round(float(x), n) for x in v]


def _nesne(ad):
    ob = bpy.data.objects.get(ad)
    if ob is None:
        benzer = [o.name for o in bpy.data.objects if ad.lower() in o.name.lower()][:10]
        raise KeyError(f"'{ad}' adlı nesne yok." + (f" Benzerler: {benzer}" if benzer else ""))
    return ob


def _renk(c, alfa=False):
    """'#rrggbb' ya da [r,g,b] (sRGB 0-1) → lineer RGB(A)."""
    if c is None:
        return None
    if isinstance(c, str):
        h = c.lstrip("#")
        if len(h) != 6:
            raise ValueError(f"renk '#rrggbb' biçiminde olmalı: {c}")
        c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    c = [float(x) for x in c][:3]
    lin = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return lin + [1.0] if alfa else lin


def _derece(r):
    return Euler([math.radians(float(x)) for x in r], "XYZ")


def _koleksiyon(ad):
    sc = bpy.context.scene
    k = bpy.data.collections.get(ad)
    if k is None:
        k = bpy.data.collections.new(ad)
    if k.name not in sc.collection.children:
        sc.collection.children.link(k)
    return k


def _merkez(ob):
    """Nesnenin dünya koordinatında sınır kutusu merkezi."""
    if ob.type in {"MESH", "CURVE", "FONT", "SURFACE", "META"} and not ob.get("jarvis_splat"):
        kose = [ob.matrix_world @ Vector(k) for k in ob.bound_box]
        return sum(kose, Vector()) / 8
    return ob.matrix_world.translation.copy()


def _nokta(hedef):
    """Nesne adı ya da [x,y,z] → Vector. None → sahne merkezi."""
    if hedef is None:
        return _sahne_kutusu()[0]
    if isinstance(hedef, str):
        return _merkez(_nesne(hedef))
    return Vector([float(x) for x in hedef])


def _sahne_kutusu():
    """(merkez, yarıçap) — kamera/ışık dışındaki görünür nesnelerden."""
    noktalar = []
    for ob in bpy.context.scene.objects:
        if ob.type not in {"MESH", "CURVE", "FONT"} or ob.hide_render:
            continue
        if ob.get("jarvis_splat"):
            noktalar.append(ob.matrix_world.translation)
            continue
        noktalar += [ob.matrix_world @ Vector(k) for k in ob.bound_box]
    if not noktalar:
        return Vector((0, 0, 0)), 1.0
    mn = Vector([min(p[i] for p in noktalar) for i in range(3)])
    mx = Vector([max(p[i] for p in noktalar) for i in range(3)])
    return (mn + mx) / 2, max((mx - mn).length / 2, 0.5)


def _bak(ob, hedef):
    yon = hedef - ob.matrix_world.translation
    if yon.length > 1e-6:
        ob.rotation_euler = yon.to_track_quat("-Z", "Y").to_euler()


def _fcurves(ob):
    ad = ob.animation_data
    if not ad or not ad.action:
        return []
    act = ad.action
    if hasattr(act, "layers") and getattr(ad, "action_slot", None) is not None:
        from bpy_extras import anim_utils
        cb = anim_utils.action_get_channelbag_for_slot(act, ad.action_slot)
        return list(cb.fcurves) if cb else []
    return list(getattr(act, "fcurves", []))


def _ozet(ob):
    d = {"ad": ob.name, "tur": ob.type, "konum": _r(ob.location),
         "rotasyon": _r([math.degrees(a) for a in ob.rotation_euler], 1),
         "olcek": _r(ob.scale), "boyut": _r(ob.dimensions)}
    if ob.parent:
        d["ebeveyn"] = ob.parent.name
    if ob.type == "MESH":
        d["materyaller"] = [m.name for m in ob.data.materials if m]
        if ob.get("jarvis_splat"):
            d["splat"] = len(ob.data.vertices)
    elif ob.type == "LIGHT":
        d["isik"] = {"tur": ob.data.type, "guc": ob.data.energy}
    elif ob.type == "CAMERA":
        d["lens_mm"] = round(ob.data.lens, 2)
        if ob.data.dof.use_dof:
            d["f_stop"] = round(ob.data.dof.aperture_fstop, 2)
    return d


def _g870():
    try:
        from . import g870_profil
        return g870_profil
    except ImportError:
        yol = os.path.join(os.path.dirname(__file__), "..", "..", "..", "blender", "g870_profil.py")
        spec = importlib.util.spec_from_file_location("g870_profil", os.path.abspath(yol))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod


# ================================================================== sahne

def ping():
    return {"blender": bpy.app.version_string, "arayuzsuz": bpy.app.background,
            "dosya": bpy.data.filepath or None}


def get_scene_info(limit=200):
    sc = bpy.context.scene
    r = sc.render
    w = sc.world
    return {
        "blender": bpy.app.version_string,
        "dosya": bpy.data.filepath or None,
        "motor": r.engine,
        "cozunurluk": [r.resolution_x, r.resolution_y, r.resolution_percentage],
        "fps": r.fps,
        "kare_araligi": [sc.frame_start, sc.frame_end],
        "kare": sc.frame_current,
        "kamera": sc.camera.name if sc.camera else None,
        "renk": {"donusum": sc.view_settings.view_transform, "gorunum": sc.view_settings.look,
                 "pozlama": sc.view_settings.exposure},
        "dunya": w.name if w else None,
        "nesne_sayisi": len(sc.objects),
        "nesneler": [_ozet(o) for o in list(sc.objects)[:limit]],
    }


def get_object_info(name):
    ob = _nesne(name)
    d = _ozet(ob)
    d["dunya_merkezi"] = _r(_merkez(ob))
    d["gorunur"] = {"viewport": not ob.hide_get(), "render": not ob.hide_render}
    d["degistiriciler"] = [f"{m.name} ({m.type})" for m in ob.modifiers]
    if ob.type == "MESH" and not ob.get("jarvis_splat"):
        d["kose"], d["yuz"] = len(ob.data.vertices), len(ob.data.polygons)
    d["animasyonlu"] = bool(_fcurves(ob))
    return d


def clear_scene(keep_camera=False, keep_lights=False):
    sil = [o for o in bpy.context.scene.objects
           if not (keep_camera and o.type == "CAMERA") and not (keep_lights and o.type == "LIGHT")]
    for o in sil:
        bpy.data.objects.remove(o, do_unlink=True)
    for blok in (bpy.data.meshes, bpy.data.materials, bpy.data.lights, bpy.data.cameras,
                 bpy.data.node_groups, bpy.data.images, bpy.data.curves):
        for x in list(blok):
            if x.users == 0:
                blok.remove(x)
    return {"silinen": len(sil)}


def save_file(path=None):
    if path:
        path = bpy.path.abspath(path)
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=path)
    elif bpy.data.filepath:
        bpy.ops.wm.save_mainfile()
    else:
        raise ValueError("Dosya hiç kaydedilmemiş; 'path' ver (ör. D:/proje/sahne.blend).")
    return {"dosya": bpy.data.filepath}


def open_file(path):
    bpy.ops.wm.open_mainfile(filepath=bpy.path.abspath(path))
    return {"dosya": bpy.data.filepath}


# ================================================================ nesneler

_SEKILLER = ("cube", "sphere", "ico_sphere", "cylinder", "cone", "plane", "monkey", "torus", "text", "empty")


def create_object(type="cube", name=None, location=(0, 0, 0), rotation=(0, 0, 0),
                  scale=(1, 1, 1), size=1.0, text=None, smooth=True, bevel=0.0):
    """size: küp kenarı / küre çapı / silindir çapı ve boyu / düzlem kenarı (m)."""
    if type not in _SEKILLER:
        raise ValueError(f"type şunlardan biri olmalı: {_SEKILLER}")
    sc = bpy.context.scene
    ad = name or type.capitalize()
    if type == "empty":
        ob = bpy.data.objects.new(ad, None)
        ob.empty_display_type = "PLAIN_AXES"
    elif type == "text":
        cu = bpy.data.curves.new(ad, "FONT")
        cu.body = text or ad
        cu.align_x, cu.align_y = "CENTER", "CENTER"
        cu.size = size
        cu.extrude = size * 0.05
        cu.bevel_depth = size * 0.01
        ob = bpy.data.objects.new(ad, cu)
    else:
        me = bpy.data.meshes.new(ad)
        bm = bmesh.new()
        r = size / 2
        if type == "cube":
            bmesh.ops.create_cube(bm, size=size, calc_uvs=True)
        elif type == "sphere":
            bmesh.ops.create_uvsphere(bm, u_segments=64, v_segments=32, radius=r, calc_uvs=True)
        elif type == "ico_sphere":
            bmesh.ops.create_icosphere(bm, subdivisions=3, radius=r, calc_uvs=True)
        elif type in ("cylinder", "cone"):
            bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=64,
                                  radius1=r, radius2=r if type == "cylinder" else 0.0,
                                  depth=size, calc_uvs=True)
        elif type == "plane":
            bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=r, calc_uvs=True)
        elif type == "monkey":
            bmesh.ops.create_monkey(bm, calc_uvs=True)
            bmesh.ops.scale(bm, vec=(r, r, r), verts=bm.verts)
        elif type == "torus":
            R, rr = r * 0.75, r * 0.25
            for i in range(48):
                a = 2 * math.pi * i / 48
                for j in range(24):
                    b = 2 * math.pi * j / 24
                    bm.verts.new(((R + rr * math.cos(b)) * math.cos(a),
                                  (R + rr * math.cos(b)) * math.sin(a), rr * math.sin(b)))
            bm.verts.ensure_lookup_table()
            for i in range(48):
                for j in range(24):
                    v = lambda a, b: bm.verts[(a % 48) * 24 + (b % 24)]
                    bm.faces.new((v(i, j), v(i + 1, j), v(i + 1, j + 1), v(i, j + 1)))
        bm.to_mesh(me)
        bm.free()
        if smooth and type in ("sphere", "ico_sphere", "cylinder", "cone", "monkey", "torus"):
            me.shade_smooth()
        ob = bpy.data.objects.new(ad, me)
        if bevel > 0:  # keskin kenar CGI'ın en belirgin işaretidir; hafif pah gerçekçi kılar
            m = ob.modifiers.new("Pah", "BEVEL")
            m.width, m.segments = bevel, 3
            m.limit_method = "ANGLE"
    sc.collection.objects.link(ob)
    ob.location = location
    ob.rotation_euler = _derece(rotation)
    ob.scale = scale
    return _ozet(ob)


def transform_object(name, location=None, rotation=None, scale=None, look_at=None, parent=None):
    ob = _nesne(name)
    if location is not None:
        ob.location = location
    if rotation is not None:
        ob.rotation_euler = _derece(rotation)
    if scale is not None:
        ob.scale = scale if isinstance(scale, (list, tuple)) else (scale,) * 3
    if parent is not None:
        ob.parent = _nesne(parent) if parent else None
    bpy.context.view_layer.update()
    if look_at is not None:
        _bak(ob, _nokta(look_at))
    return _ozet(ob)


def delete_objects(names):
    if isinstance(names, str):
        names = [names]
    silinen = []
    for ad in names:
        ob = bpy.data.objects.get(ad)
        if ob:
            bpy.data.objects.remove(ob, do_unlink=True)
            silinen.append(ad)
    return {"silinen": silinen}


def duplicate_object(name, new_name=None, location=None, linked=True):
    ob = _nesne(name)
    yeni = ob.copy()
    if ob.data is not None and not linked:
        yeni.data = ob.data.copy()
    if new_name:
        yeni.name = new_name
    for k in ob.users_collection:
        k.objects.link(yeni)
    if location is not None:
        yeni.location = location
    return _ozet(yeni)


def keyframe_object(name, frame, location=None, rotation=None, scale=None):
    ob = _nesne(name)
    if location is not None:
        ob.location = location
        ob.keyframe_insert("location", frame=frame)
    if rotation is not None:
        ob.rotation_euler = _derece(rotation)
        ob.keyframe_insert("rotation_euler", frame=frame)
    if scale is not None:
        ob.scale = scale
        ob.keyframe_insert("scale", frame=frame)
    return {"nesne": ob.name, "kare": frame}


def import_model(path, name=None, location=None, scale=None):
    path = bpy.path.abspath(path)
    if not os.path.isfile(path):
        raise FileNotFoundError(path)
    uz = os.path.splitext(path)[1].lower()
    once = set(bpy.data.objects)
    if uz == ".ply":
        with open(path, "rb") as f:
            bas = f.read(4096)
        if b"f_dc_0" in bas or b"element chunk" in bas:
            return import_gaussian_splat(path, name=name)
        bpy.ops.wm.ply_import(filepath=path)
    elif uz in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif uz == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path)
    elif uz == ".obj":
        bpy.ops.wm.obj_import(filepath=path)
    elif uz in (".usd", ".usda", ".usdc", ".usdz"):
        bpy.ops.wm.usd_import(filepath=path)
    elif uz == ".stl":
        bpy.ops.wm.stl_import(filepath=path)
    elif uz == ".abc":
        bpy.ops.wm.alembic_import(filepath=path)
    elif uz == ".splat":
        return import_gaussian_splat(path, name=name)
    elif uz == ".blend":
        with bpy.data.libraries.load(path, link=False) as (src, dst):
            dst.objects = list(src.objects)
        for ob in dst.objects:
            if ob is not None:
                bpy.context.scene.collection.objects.link(ob)
    else:
        raise ValueError(f"desteklenmeyen biçim: {uz}")
    yeni = [o for o in bpy.data.objects if o not in once]
    kokler = [o for o in yeni if o.parent is None or o.parent not in yeni]
    if len(kokler) > 1 and (location is not None or scale is not None or name):
        kok = bpy.data.objects.new(name or os.path.splitext(os.path.basename(path))[0], None)
        bpy.context.scene.collection.objects.link(kok)
        for o in kokler:
            o.parent = kok
        kokler = [kok]
    for o in kokler:
        if name and len(kokler) == 1:
            o.name = name
        if location is not None:
            o.location = location
        if scale is not None:
            o.scale = (scale,) * 3 if isinstance(scale, (int, float)) else scale
    return {"eklenen": [o.name for o in yeni][:50], "kok": [o.name for o in kokler]}


# ================================================================ materyal

_ON_AYAR = {
    # ad: (renk sRGB, metalik, pürüzlülük, ekstra)
    "altin": ("#ffc356", 1.0, 0.18, {}),
    "krom": ("#f0f0f0", 1.0, 0.05, {}),
    "fircalanmis_celik": ("#b4b4b4", 1.0, 0.35, {"Anisotropic": 0.6}),
    "bakir": ("#f29e74", 1.0, 0.25, {}),
    "cam": ("#ffffff", 0.0, 0.0, {"Transmission Weight": 1.0, "IOR": 1.5}),
    "buzlu_cam": ("#ffffff", 0.0, 0.3, {"Transmission Weight": 1.0, "IOR": 1.5}),
    "su": ("#e6f2ff", 0.0, 0.02, {"Transmission Weight": 1.0, "IOR": 1.333}),
    "parlak_plastik": ("#d92b2b", 0.0, 0.15, {"Coat Weight": 0.5}),
    "mat_plastik": ("#3a3a3a", 0.0, 0.6, {}),
    "kaucuk": ("#151515", 0.0, 0.85, {}),
    "seramik": ("#f4f1ea", 0.0, 0.08, {"Coat Weight": 1.0}),
    "araba_boyasi": ("#0b2a6b", 0.6, 0.35, {"Coat Weight": 1.0, "Coat Roughness": 0.02}),
    "deri": ("#4a2c1a", 0.0, 0.55, {"Sheen Weight": 0.3}),
    "kumas": ("#7a8899", 0.0, 0.9, {"Sheen Weight": 1.0}),
    "cilt": ("#e0ac8b", 0.0, 0.45, {"Subsurface Weight": 0.3, "Subsurface Scale": 0.01}),
    "mermer": ("#efece6", 0.0, 0.12, {"Subsurface Weight": 0.15, "Subsurface Scale": 0.02}),
    "beton": ("#8c8a85", 0.0, 0.85, {}),
    "neon": ("#ff2bd6", 0.0, 0.4, {"Emission Strength": 15.0}),
}


def set_material(object, preset=None, color=None, metallic=None, roughness=None,
                 emission_color=None, emission_strength=None, transmission=None,
                 ior=None, alpha=None, coat=None, subsurface=None, name=None, slot=0):
    ob = _nesne(object)
    if ob.data is None or not hasattr(ob.data, "materials"):
        raise ValueError(f"{ob.name} materyal alamaz ({ob.type})")
    ekstra = {}
    if preset:
        if preset not in _ON_AYAR:
            raise ValueError(f"preset şunlardan biri: {sorted(_ON_AYAR)}")
        pc, pm, pr, ekstra = _ON_AYAR[preset]
        color = color or pc
        metallic = pm if metallic is None else metallic
        roughness = pr if roughness is None else roughness
        if preset == "neon" and emission_color is None:
            emission_color = color
    m = bpy.data.materials.new(name or f"{ob.name}_{preset or 'Materyal'}")
    if m.node_tree is None:
        m.use_nodes = True
    p = m.node_tree.nodes.get("Principled BSDF")
    girdi = {"Base Color": _renk(color, True), "Metallic": metallic, "Roughness": roughness,
             "Emission Color": _renk(emission_color, True), "Emission Strength": emission_strength,
             "Transmission Weight": transmission, "IOR": ior, "Alpha": alpha,
             "Coat Weight": coat, "Subsurface Weight": subsurface}
    girdi.update({k: v for k, v in ekstra.items() if girdi.get(k) is None})
    for k, v in girdi.items():
        if v is not None and k in p.inputs:
            p.inputs[k].default_value = v
    if color is not None:
        m.diffuse_color = _renk(color, True)
    if len(ob.data.materials) > slot:
        ob.data.materials[slot] = m
    else:
        ob.data.materials.append(m)
    return {"nesne": ob.name, "materyal": m.name}


# ==================================================================== ışık

def add_light(type="AREA", name=None, location=(4, -4, 5), target=None, rotation=None,
              energy=None, color="#ffffff", size=1.0, spot_angle=45.0, temperature=None):
    """temperature: Kelvin (ör. 3200 tungsten, 5600 gün ışığı) — verilirse color'ı ezer."""
    type = type.upper()
    varsayilan = {"POINT": 500, "SPOT": 1000, "AREA": 300, "SUN": 4}
    li = bpy.data.lights.new(name or f"{type.capitalize()}_Isik", type)
    li.energy = varsayilan[type] if energy is None else energy
    li.color = _renk(_kelvin(temperature) if temperature else color)
    if type == "AREA":
        li.shape, li.size = "DISK", size
    elif type in ("POINT", "SPOT"):
        li.shadow_soft_size = size / 2
    elif type == "SUN":
        li.angle = math.radians(max(size, 0.1))
    if type == "SPOT":
        li.spot_size = math.radians(spot_angle)
        li.spot_blend = 0.3
    ob = bpy.data.objects.new(li.name, li)
    _koleksiyon("Jarvis_Isik").objects.link(ob)
    ob.location = location
    if rotation is not None:
        ob.rotation_euler = _derece(rotation)
    else:
        bpy.context.view_layer.update()
        _bak(ob, _nokta(target))
    return _ozet(ob)


def _kelvin(k):
    """Renk sıcaklığı (K) → sRGB [0-1] (Tanner Helland yaklaşımı)."""
    t = max(1000.0, min(40000.0, float(k))) / 100.0
    r = 255 if t <= 66 else 329.698727446 * (t - 60) ** -0.1332047592
    g = 99.4708025861 * math.log(t) - 161.1195681661 if t <= 66 else 288.1221695283 * (t - 60) ** -0.0755148492
    b = 255 if t >= 66 else (0 if t <= 19 else 138.5177312231 * math.log(t - 10) - 305.0447927307)
    return [max(0.0, min(255.0, x)) / 255 for x in (r, g, b)]


_ISIK_DUZENLERI = ("three_point", "golden_hour", "studio", "noir", "neon", "moonlight", "overcast")


def lighting_preset(preset="three_point", target=None, strength=1.0, clear_existing=True):
    """Sinema ışık düzenleri. Mesafe ve güç sahnenin boyutuna göre ölçeklenir."""
    if preset not in _ISIK_DUZENLERI:
        raise ValueError(f"preset şunlardan biri: {_ISIK_DUZENLERI}")
    if clear_existing:
        k = bpy.data.collections.get("Jarvis_Isik")
        if k:
            for o in list(k.objects):
                bpy.data.objects.remove(o, do_unlink=True)
    if isinstance(target, str):
        c, r = _merkez(_nesne(target)), max(_nesne(target).dimensions.length / 2, 0.5)
    elif target is not None:
        c, r = _nokta(target), 1.0
    else:
        c, r = _sahne_kutusu()
    sc = bpy.context.scene
    # "Ön" = kameranın baktığı yön; kamera yoksa -Y
    on = Vector((0, -1, 0))
    if sc.camera:
        v = sc.camera.matrix_world.translation - c
        v.z = 0
        if v.length > 1e-3:
            on = v.normalized()
    sag = on.cross(Vector((0, 0, 1))).normalized()
    g = strength * r * r
    hdri_var = _dunya_hdri_var()

    def arka_plan(renk, guc):  # HDRI/gökyüzü kurulmuşsa onu koru
        if not hdri_var:
            world_color(renk, guc)

    def poz(on_k, sag_k, yuk):
        return list(c + on * on_k * r + sag * sag_k * r + Vector((0, 0, yuk * r)))

    eklenen = []
    E = lambda **kw: eklenen.append(add_light(target=list(c), **kw)["ad"])
    if preset == "three_point":
        E(type="AREA", name="Ana", location=poz(2.2, -2.2, 1.8), energy=800 * g, size=1.5 * r, temperature=5200)
        E(type="AREA", name="Dolgu", location=poz(2.5, 2.5, 0.6), energy=150 * g, size=2.5 * r, temperature=6500)
        E(type="AREA", name="Kontur", location=poz(-2.5, 1.0, 2.2), energy=600 * g, size=0.8 * r, temperature=7500)
        arka_plan("#0d0f14", 1.0)
    elif preset == "golden_hour":
        E(type="SUN", name="Gunes", location=poz(-3, -2, 0.6), energy=4 * strength, size=1.0, temperature=3000)
        E(type="AREA", name="Gok_Dolgu", location=poz(2, 2, 2), energy=60 * g, size=4 * r, temperature=9000)
        gy = Vector(poz(-3, -2, 0)) - c
        set_world(sky=True, sun_elevation=6, strength=0.6 * strength,
                  sun_rotation=math.degrees(math.atan2(gy.x, gy.y)))
    elif preset == "studio":
        E(type="AREA", name="Tavan_Softbox", location=poz(0.3, 0, 3), energy=1000 * g, size=3 * r, temperature=5600)
        E(type="AREA", name="Serit_Sol", location=poz(0.5, -2.5, 1), energy=400 * g, size=0.5 * r, temperature=5600)
        E(type="AREA", name="Serit_Sag", location=poz(0.5, 2.5, 1), energy=400 * g, size=0.5 * r, temperature=5600)
        arka_plan("#202020", 1.0)
    elif preset == "noir":
        E(type="SPOT", name="Sert_Isik", location=poz(1, -3, 2.5), energy=3000 * g, size=0.05, spot_angle=35, temperature=4000)
        arka_plan("#000000", 0.0)
    elif preset == "neon":
        E(type="AREA", name="Neon_Pembe", location=poz(1.2, -2.2, 0.8), energy=500 * g, size=0.4 * r, color="#ff1ea8")
        E(type="AREA", name="Neon_Camgobegi", location=poz(1.2, 2.2, 0.8), energy=500 * g, size=0.4 * r, color="#16e0ff")
        E(type="AREA", name="Kontur", location=poz(-2.5, 0, 2), energy=300 * g, size=0.6 * r, color="#9b5cff")
        arka_plan("#03040a", 1.0)
    elif preset == "moonlight":
        E(type="SUN", name="Ay", location=poz(-2, -2, 2), energy=0.4 * strength, size=0.5, temperature=12000)
        arka_plan("#04070f", 1.0)
    elif preset == "overcast":
        set_world(sky=True, sun_elevation=35, strength=0.35 * strength, sun_intensity=0.0)
    return {"duzen": preset, "isiklar": eklenen, "merkez": _r(c), "olcek_m": round(r, 2)}


# ============================================================ dünya / hava

def _dunya():
    sc = bpy.context.scene
    if sc.world is None:
        sc.world = bpy.data.worlds.new("Dunya")
    w = sc.world
    if w.node_tree is None:
        w.use_nodes = True
    return w


def _dunya_hdri_var():
    w = bpy.context.scene.world
    return bool(w and w.node_tree and any(
        n.bl_idname in ("ShaderNodeTexEnvironment", "ShaderNodeTexSky") for n in w.node_tree.nodes))


def world_color(color="#101010", strength=1.0):
    w = _dunya()
    N, L = w.node_tree.nodes, w.node_tree.links
    cikis = next((n for n in N if n.bl_idname == "ShaderNodeOutputWorld"), None) or N.new("ShaderNodeOutputWorld")
    for n in [n for n in N if n.bl_idname != "ShaderNodeOutputWorld" and n.name != "Jarvis_Atmosfer"]:
        N.remove(n)
    bg = N.new("ShaderNodeBackground")
    bg.inputs["Color"].default_value = _renk(color, True)
    bg.inputs["Strength"].default_value = strength
    L.new(bg.outputs[0], cikis.inputs["Surface"])
    return {"dunya": "renk", "renk": color}


def set_world(hdri_path=None, polyhaven_id=None, sky=False, strength=1.0, rotation=0.0,
              sun_elevation=15.0, sun_rotation=0.0, sun_intensity=1.0, resolution="2k",
              background_visible=True):
    """HDRI (yerel dosya ya da Poly Haven id) veya fiziksel gökyüzü."""
    w = _dunya()
    N, L = w.node_tree.nodes, w.node_tree.links
    cikis = next((n for n in N if n.bl_idname == "ShaderNodeOutputWorld"), None) or N.new("ShaderNodeOutputWorld")
    for n in [n for n in N if n.bl_idname != "ShaderNodeOutputWorld" and n.name != "Jarvis_Atmosfer"]:
        N.remove(n)
    bg = N.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = strength
    sonuc = {}
    if polyhaven_id:
        hdri_path = polyhaven.hdri_indir(polyhaven_id, resolution)
        sonuc["polyhaven"] = polyhaven_id
    if hdri_path:
        t = N.new("ShaderNodeTexEnvironment")
        t.image = bpy.data.images.load(bpy.path.abspath(hdri_path), check_existing=True)
        koord, harita = N.new("ShaderNodeTexCoord"), N.new("ShaderNodeMapping")
        harita.inputs["Rotation"].default_value[2] = math.radians(rotation)
        L.new(koord.outputs["Generated"], harita.inputs["Vector"])
        L.new(harita.outputs["Vector"], t.inputs["Vector"])
        L.new(t.outputs["Color"], bg.inputs["Color"])
        sonuc["hdri"] = hdri_path
    elif sky:
        t = N.new("ShaderNodeTexSky")
        turler = [i.identifier for i in t.bl_rna.properties["sky_type"].enum_items]
        t.sky_type = next(x for x in ("MULTIPLE_SCATTERING", "NISHITA", "HOSEK_WILKIE") if x in turler)
        for ad, deger in (("sun_elevation", math.radians(sun_elevation)),
                          ("sun_rotation", math.radians(sun_rotation)),
                          ("sun_intensity", sun_intensity), ("sun_disc", sun_intensity > 0)):
            if hasattr(t, ad):
                setattr(t, ad, deger)
        L.new(t.outputs["Color"], bg.inputs["Color"])
        sonuc["gokyuzu"] = t.sky_type
    else:
        raise ValueError("hdri_path, polyhaven_id ya da sky=True ver")
    if background_visible:
        L.new(bg.outputs[0], cikis.inputs["Surface"])
    else:  # ışık HDRI'dan, arka plan düz koyu (ürün çekimi)
        lp, karis, duz = N.new("ShaderNodeLightPath"), N.new("ShaderNodeMixShader"), N.new("ShaderNodeBackground")
        duz.inputs["Color"].default_value = (0.02, 0.02, 0.02, 1)
        L.new(lp.outputs["Is Camera Ray"], karis.inputs["Fac"])
        L.new(bg.outputs[0], karis.inputs[1])
        L.new(duz.outputs[0], karis.inputs[2])
        L.new(karis.outputs[0], cikis.inputs["Surface"])
    return sonuc


def add_atmosphere(density=0.02, anisotropy=0.6, color="#ffffff", remove=False):
    """Hacimsel sis: ışık hüzmeleri (god rays) ve derinlik hissi. density 0.005-0.05 arası."""
    w = _dunya()
    N, L = w.node_tree.nodes, w.node_tree.links
    eski = N.get("Jarvis_Atmosfer")
    if eski:
        N.remove(eski)
    if remove:
        return {"atmosfer": False}
    cikis = next(n for n in N if n.bl_idname == "ShaderNodeOutputWorld")
    v = N.new("ShaderNodeVolumePrincipled")
    v.name = "Jarvis_Atmosfer"
    v.inputs["Density"].default_value = density
    v.inputs["Anisotropy"].default_value = anisotropy
    v.inputs["Color"].default_value = _renk(color, True)
    L.new(v.outputs[0], cikis.inputs["Volume"])
    sc = bpy.context.scene
    if hasattr(sc.eevee, "volumetric_end"):
        sc.eevee.volumetric_end = max(sc.eevee.volumetric_end, _sahne_kutusu()[1] * 6)
    return {"atmosfer": True, "yogunluk": density,
            "not": "Cycles'ta hacim render süresini 2-4 kat artırır; EEVEE'de ucuzdur."}


# ================================================================== kamera

_FORMATLAR = {
    "fhd": (1920, 1080), "uhd": (3840, 2160), "qhd": (2560, 1440),
    "cinema_239": (1920, 804), "cinema_239_4k": (4096, 1716), "cinema_185": (1998, 1080),
    "vertical": (1080, 1920), "square": (1080, 1080), "portrait_45": (1080, 1350),
}


def set_render_format(preset="cinema_239", fps=24, frame_start=None, frame_end=None,
                      duration_seconds=None, percentage=100):
    if preset not in _FORMATLAR:
        raise ValueError(f"preset şunlardan biri: {sorted(_FORMATLAR)}")
    sc = bpy.context.scene
    r = sc.render
    r.resolution_x, r.resolution_y = _FORMATLAR[preset]
    r.resolution_percentage = percentage
    r.fps, r.fps_base = int(fps), 1.0
    if frame_start is not None:
        sc.frame_start = frame_start
    if duration_seconds is not None:
        sc.frame_end = sc.frame_start + int(round(duration_seconds * fps)) - 1
    elif frame_end is not None:
        sc.frame_end = frame_end
    return {"cozunurluk": [r.resolution_x, r.resolution_y], "fps": r.fps,
            "kareler": [sc.frame_start, sc.frame_end]}


def setup_camera(name="Kamera", location=None, target=None, focal_length=50.0, fstop=None,
                 focus_target=None, sensor_width=36.0, shift_x=0.0, shift_y=0.0, make_active=True):
    """Fiziksel kamera. focal_length: 24 geniş, 35 doğal, 50 klasik, 85 portre, 135 sıkıştırılmış.
    fstop verilirse alan derinliği açılır (1.4-2.8 sinematik bulanıklık)."""
    ob = bpy.data.objects.get(name)
    if ob is None or ob.type != "CAMERA":
        cam = bpy.data.cameras.new(name)
        ob = bpy.data.objects.new(name, cam)
        bpy.context.scene.collection.objects.link(ob)
    c = ob.data
    c.lens, c.sensor_width, c.sensor_fit = focal_length, sensor_width, "HORIZONTAL"
    c.shift_x, c.shift_y = shift_x, shift_y
    c.clip_start, c.clip_end = 0.05, 2000
    merkez, yaricap = _sahne_kutusu()
    hedef = _nokta(target) if target is not None else merkez
    if location is None:  # konum yoksa: sahneyi kadraja alacak mesafe
        mesafe = yaricap * focal_length / sensor_width * 1.6
        location = list(hedef + Vector((0.0, -1.0, 0.35)).normalized() * mesafe)
    ob.location = location
    bpy.context.view_layer.update()
    for k in [k for k in ob.constraints if k.name.startswith("Jarvis")]:
        ob.constraints.remove(k)
    _bak(ob, hedef)
    if fstop:
        c.dof.use_dof = True
        c.dof.aperture_fstop = fstop
        c.dof.aperture_blades = 7          # sinema lensi bokeh şekli
        if isinstance(focus_target or target, str):
            c.dof.focus_object = _nesne(focus_target or target)
        else:
            c.dof.focus_object = None
            c.dof.focus_distance = (Vector(location) - _nokta(focus_target or target)).length \
                if (focus_target or target) is not None else (Vector(location) - hedef).length
    else:
        c.dof.use_dof = False
    if make_active:
        bpy.context.scene.camera = ob
    return _ozet(ob)


_HAREKETLER = ("orbit", "push_in", "pull_out", "truck", "crane_up", "crane_down",
               "flyover", "reveal", "static")


def camera_move(move="push_in", camera=None, target=None, frame_start=None, frame_end=None,
                distance=None, height=None, angle=90.0, amount=0.4, shake=0.0, ease="smooth"):
    """Sinematik kamera hareketi. Kamera hedefe 'Track To' ile kilitlenir.

    move: orbit (hedef etrafında 'angle' derece döner), push_in (yavaşça yaklaşır),
          pull_out (uzaklaşır), truck (yana kayar), crane_up/crane_down (vinç),
          flyover (üstten geçer), reveal (alçaktan yükselip öne açılır), static.
    amount: hareket oranı (mesafeye göre, 0.4 = %40).
    shake : el kamerası titremesi (0 kapalı, 0.02 hafif, 0.08 belirgin).
    ease  : smooth (yumuşak başla/bitir) ya da linear.
    """
    if move not in _HAREKETLER:
        raise ValueError(f"move şunlardan biri: {_HAREKETLER}")
    sc = bpy.context.scene
    ob = _nesne(camera) if camera else sc.camera
    if ob is None:
        ob = bpy.data.objects.get(setup_camera(target=target)["ad"])
    sc.camera = ob
    f0 = sc.frame_start if frame_start is None else frame_start
    f1 = sc.frame_end if frame_end is None else frame_end
    hedef = _nokta(target)

    # Hedef boşluğu (empty) + Track To
    he = bpy.data.objects.get(f"{ob.name}_Hedef")
    if he is None:
        he = bpy.data.objects.new(f"{ob.name}_Hedef", None)
        he.empty_display_type, he.empty_display_size = "SPHERE", 0.2
        sc.collection.objects.link(he)
    he.location = hedef
    for k in [k for k in ob.constraints if k.name.startswith("Jarvis")]:
        ob.constraints.remove(k)
    tk = ob.constraints.new("TRACK_TO")
    tk.name, tk.target = "Jarvis_Takip", he
    tk.track_axis, tk.up_axis = "TRACK_NEGATIVE_Z", "UP_Y"
    if ob.data.dof.use_dof and ob.data.dof.focus_object is None:
        ob.data.dof.focus_object = he

    for nesne in (ob, he):
        if nesne.animation_data:
            nesne.animation_data_clear()

    bas = ob.location.copy()
    rel = bas - hedef
    d = distance or max(rel.length, 1.0)
    yatay = Vector((rel.x, rel.y, 0))
    yatay = yatay.normalized() if yatay.length > 1e-3 else Vector((0, -1, 0))
    h = rel.z if height is None else height
    sag = yatay.cross(Vector((0, 0, 1))).normalized()
    a0 = math.atan2(yatay.y, yatay.x)
    yatay_d = math.sqrt(max(d * d - h * h, 0.01))

    def P(yat, yuk, yana=0.0):
        return hedef + yatay * yat + Vector((0, 0, yuk)) + sag * yana

    if move == "orbit":
        adim = max(4, int(abs(angle) / 15))
        yol = []
        for i in range(adim + 1):
            a = a0 + math.radians(angle) * i / adim
            yol.append(hedef + Vector((math.cos(a) * yatay_d, math.sin(a) * yatay_d, h)))
    elif move == "push_in":
        yol = [P(yatay_d, h), P(yatay_d * (1 - amount), h * (1 - amount * 0.5))]
    elif move == "pull_out":
        yol = [P(yatay_d * (1 - amount), h * (1 - amount * 0.5)), P(yatay_d, h)]
    elif move == "truck":
        yol = [P(yatay_d, h, -d * amount), P(yatay_d, h, d * amount)]
    elif move == "crane_up":
        yol = [P(yatay_d, max(h - d * amount, 0.2)), P(yatay_d * 1.05, h + d * amount)]
    elif move == "crane_down":
        yol = [P(yatay_d * 1.05, h + d * amount), P(yatay_d, max(h - d * amount, 0.2))]
    elif move == "flyover":
        yol = [P(yatay_d * 1.5, h + d * 0.3), P(0.01, h + d * 0.6), P(-yatay_d, h + d * 0.4)]
    elif move == "reveal":
        yol = [P(yatay_d * 0.6, 0.15), P(yatay_d, h + d * amount * 0.5)]
    else:
        yol = [bas]

    tercih = bpy.context.preferences.edit
    eski = tercih.keyframe_new_interpolation_type
    tercih.keyframe_new_interpolation_type = "LINEAR" if ease == "linear" else "BEZIER"
    try:
        for i, p in enumerate(yol):
            kare = f0 if len(yol) == 1 else round(f0 + (f1 - f0) * i / (len(yol) - 1))
            ob.location = p
            ob.keyframe_insert("location", frame=kare)
        if shake > 0:
            he.keyframe_insert("location", frame=f0)
            for nesne, guc in ((ob, shake * d * 0.15), (he, shake * d * 0.3)):
                for fc in _fcurves(nesne):
                    if fc.data_path == "location":
                        m = fc.modifiers.new("NOISE")
                        m.strength, m.scale, m.phase = guc, 18.0, 7.3 * (fc.array_index + 1)
    finally:
        tercih.keyframe_new_interpolation_type = eski
    sc.frame_set(f0)
    return {"kamera": ob.name, "hareket": move, "kareler": [f0, f1],
            "anahtar_kare": len(yol), "baslangic": _r(yol[0]), "bitis": _r(yol[-1])}


# ============================================================ renk / görünüm

_GORUNUMLER = {
    "cinema": ("AgX", ["AgX - Medium High Contrast", "Medium High Contrast", "AgX - Punchy"]),
    "punchy": ("AgX", ["AgX - Punchy", "Punchy"]),
    "natural": ("AgX", ["None"]),
    "soft": ("AgX", ["AgX - Medium Low Contrast", "Medium Low Contrast"]),
    "filmic": ("Filmic", ["Medium High Contrast", "None"]),
    "standard": ("Standard", ["None"]),       # Gaussian splat'lar için en doğru renk
}


def set_color_look(look="cinema", exposure=None, motion_blur=None, shutter=0.5):
    if look not in _GORUNUMLER:
        raise ValueError(f"look şunlardan biri: {sorted(_GORUNUMLER)}")
    v = bpy.context.scene.view_settings
    donusum, adaylar = _GORUNUMLER[look]
    v.view_transform = donusum
    secilen = None
    for a in adaylar:
        try:
            v.look = a
            secilen = a
            break
        except TypeError:
            continue
    if exposure is not None:
        v.exposure = exposure
    r = bpy.context.scene.render
    if motion_blur is not None:
        r.use_motion_blur = motion_blur
        r.motion_blur_shutter = shutter
    return {"donusum": v.view_transform, "gorunum": secilen, "pozlama": v.exposure,
            "hareket_bulanikligi": r.use_motion_blur}


# ================================================================== render

def apply_render_profile(profile="final"):
    """G870 profili: onizleme | hizli (EEVEE) | final | sinematik."""
    kademe = _g870().uygula(profile)
    sc = bpy.context.scene
    return {"profil": profile, "motor": sc.render.engine, "kademe": kademe,
            "cikti": sc.render.filepath}


def render_image(output=None, resolution_percentage=None, samples=None, frame=None,
                 engine=None, preview_max_px=1280):
    """Tek kare render. Sahnenin kalıcı ayarlarını değiştirmez (geçici olarak ezer).
    Dönüş: tam boy PNG yolu + MCP'nin göstereceği küçük JPEG önizleme yolu."""
    sc = bpy.context.scene
    r = sc.render
    if sc.camera is None:
        raise ValueError("Sahnede aktif kamera yok; önce setup_camera çağır.")
    eski = {"pct": r.resolution_percentage, "engine": r.engine, "path": r.filepath,
            "fmt": r.image_settings.file_format, "kare": sc.frame_current,
            "ornek": sc.cycles.samples if hasattr(sc, "cycles") else None,
            "taa": getattr(sc.eevee, "taa_render_samples", None)}
    klasor = os.path.join(tempfile.gettempdir(), "jarvis_render")
    os.makedirs(klasor, exist_ok=True)
    damga = time.strftime("%Y%m%d_%H%M%S")
    output = bpy.path.abspath(output) if output else os.path.join(klasor, f"kare_{damga}.png")
    try:
        if engine:
            r.engine = {"cycles": "CYCLES", "eevee": _eevee()}.get(engine.lower(), engine)
        if resolution_percentage:
            r.resolution_percentage = int(resolution_percentage)
        if samples:
            if r.engine == "CYCLES":
                sc.cycles.samples = int(samples)
            elif eski["taa"] is not None:
                sc.eevee.taa_render_samples = int(samples)
        if frame is not None:
            sc.frame_set(int(frame))
        t0 = time.time()
        bpy.ops.render.render(write_still=False)
        sure = time.time() - t0
        r.image_settings.file_format = "PNG"
        bpy.data.images["Render Result"].save_render(output, scene=sc)
        onizleme = os.path.splitext(output)[0] + "_onizleme.jpg"
        _onizleme_kaydet(output, onizleme, preview_max_px)
    finally:
        r.resolution_percentage, r.engine, r.filepath = eski["pct"], eski["engine"], eski["path"]
        r.image_settings.file_format = eski["fmt"]
        if eski["ornek"] is not None:
            sc.cycles.samples = eski["ornek"]
        if eski["taa"] is not None:
            sc.eevee.taa_render_samples = eski["taa"]
        sc.frame_set(eski["kare"])
    return {"dosya": output, "onizleme": onizleme, "sure_sn": round(sure, 1),
            "cozunurluk": [int(r.resolution_x * (resolution_percentage or eski["pct"]) / 100),
                           int(r.resolution_y * (resolution_percentage or eski["pct"]) / 100)]}


def _onizleme_kaydet(kaynak, yol, max_px):
    """PNG → küçültülmüş JPEG (Claude'a gösterilecek; bağlamı şişirmesin)."""
    im = bpy.data.images.load(kaynak)
    try:
        w, h = im.size
        k = min(1.0, max_px / max(w, h))
        if k < 1.0:
            im.scale(max(1, int(w * k)), max(1, int(h * k)))
        im.file_format = "JPEG"
        im.filepath_raw = yol
        im.save()
    finally:
        bpy.data.images.remove(im)


def _eevee():
    ids = [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    return "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in ids else "BLENDER_EEVEE"


def viewport_screenshot(max_px=1280):
    """Arayüzdeki 3B görünümün ekran görüntüsü (yalnızca arayüzlü modda)."""
    if bpy.app.background:
        raise RuntimeError("Arayüzsüz modda viewport yok; render_image kullan.")
    yol = os.path.join(tempfile.gettempdir(), "jarvis_render", f"viewport_{time.strftime('%H%M%S')}.png")
    os.makedirs(os.path.dirname(yol), exist_ok=True)
    for pencere in bpy.context.window_manager.windows:
        for alan in pencere.screen.areas:
            if alan.type == "VIEW_3D":
                with bpy.context.temp_override(window=pencere, area=alan):
                    bpy.ops.screen.screenshot_area(filepath=yol)
                im = bpy.data.images.load(yol)
                w, h = im.size
                k = min(1.0, max_px / max(w, h))
                if k < 1:
                    im.scale(int(w * k), int(h * k))
                    im.save()
                bpy.data.images.remove(im)
                return {"onizleme": yol}
    raise RuntimeError("Açık 3B görünüm bulunamadı.")


_ISLER = {}


def render_animation(profile="hizli", frame_start=None, frame_end=None, output=None):
    """Animasyonu AYRI bir arka plan Blender sürecinde render eder (bu oturum donmaz).
    Önce dosya kaydedilir. İlerleme: job_status."""
    if not bpy.data.filepath:
        raise ValueError("Önce save_file(path=...) ile sahneyi kaydet.")
    sc = bpy.context.scene
    if frame_start is not None:
        sc.frame_start = frame_start
    if frame_end is not None:
        sc.frame_end = frame_end
    bpy.ops.wm.save_mainfile()
    profil_py = _g870().__file__
    klasor = output or os.path.join(os.path.dirname(bpy.data.filepath), "render",
                                    os.path.splitext(os.path.basename(bpy.data.filepath))[0], profile)
    os.makedirs(klasor, exist_ok=True)
    gunluk = os.path.join(klasor, "render.log")
    argv = ["--profil", profile, "--cikti", klasor, "--render"]
    if bpy.app.binary_path:
        komut = [bpy.app.binary_path, "-b", bpy.data.filepath, "--python-exit-code", "1",
                 "-P", profil_py, "--"] + argv
    else:  # Blender Python modülü (pip install bpy) olarak çalışıyoruz: blender.exe yok
        komut = [sys.executable, "-c",
                 "import sys, bpy, runpy; dosya, profil = sys.argv[1], sys.argv[2]; "
                 "bpy.ops.wm.open_mainfile(filepath=dosya); "
                 "sys.argv = ['blender', '--'] + sys.argv[3:]; "
                 "runpy.run_path(profil, run_name='__main__')",
                 bpy.data.filepath, profil_py] + argv
    bayrak = getattr(subprocess, "BELOW_NORMAL_PRIORITY_CLASS", 0) if sys.platform == "win32" else 0
    with open(gunluk, "w", encoding="utf-8") as g:
        p = subprocess.Popen(komut, stdout=g, stderr=subprocess.STDOUT, creationflags=bayrak)
    _ISLER[p.pid] = {"surec": p, "gunluk": gunluk, "klasor": klasor, "baslangic": time.time(),
                     "kareler": [sc.frame_start, sc.frame_end]}
    return {"is": p.pid, "klasor": klasor, "gunluk": gunluk, "kareler": [sc.frame_start, sc.frame_end],
            "not": "Arayüzdeki Blender da VRAM kullanır; büyük sahnede arayüzü kapat."}


def job_status(job=None):
    if job is None:
        return {"isler": [{"is": k, "bitti": v["surec"].poll() is not None} for k, v in _ISLER.items()]}
    j = _ISLER.get(int(job))
    if j is None:
        raise KeyError(f"iş yok: {job}")
    kod = j["surec"].poll()
    biten = len([f for f in os.listdir(j["klasor"]) if f.startswith("kare_")])
    toplam = j["kareler"][1] - j["kareler"][0] + 1
    with open(j["gunluk"], encoding="utf-8", errors="replace") as g:
        son = g.readlines()[-6:]
    gecen = time.time() - j["baslangic"]
    return {"is": int(job), "durum": "suruyor" if kod is None else ("bitti" if kod == 0 else f"hata ({kod})"),
            "kare": f"{biten}/{toplam}", "gecen_dk": round(gecen / 60, 1),
            "tahmini_kalan_dk": round(gecen / biten * (toplam - biten) / 60, 1) if biten else None,
            "son_satirlar": [s.rstrip() for s in son], "klasor": j["klasor"]}


# =========================================================== Gaussian splat

def import_gaussian_splat(path, name=None, max_points=1_000_000, min_opacity=0.05, up_axis="-Y",
                          location=(0, 0, 0), scale=1.0, splat_size=3.0, detail=2):
    """3DGS .ply / .splat dosyasını sahneye ekler.
    up_axis: eğitimdeki yukarı eksen. COLMAP tabanlılar (Inria, gsplat, Brush, Postshot): -Y.
             Ters görünürse 'Y', yatık görünürse 'Z' dene."""
    return splat.ice_aktar(path, ad=name, max_nokta=max_points, min_opaklik=min_opacity,
                           yukari=up_axis, konum=location, olcek=scale, boyut=splat_size,
                           detay=detail)


def tune_splat(name, splat_size=None, brightness=None, show_in_viewport=None):
    return splat.ayarla(_nesne(name), splat_size, brightness, show_in_viewport)


# ============================================================== Poly Haven

def polyhaven_search(asset_type="hdris", query="", category=None, limit=20):
    return polyhaven.ara(asset_type, query, category, limit)


def polyhaven_categories(asset_type="hdris"):
    return polyhaven.kategoriler(asset_type)


def polyhaven_download(asset_id, asset_type="hdris", resolution=None, apply_to=None,
                       location=None, texture_scale=1.0, strength=1.0, rotation=0.0):
    """hdris → dünyaya uygular; models → sahneye ekler; textures → apply_to nesnesine materyal."""
    t = polyhaven.TURLER.get(asset_type, asset_type)
    if t == "hdris":
        return set_world(polyhaven_id=asset_id, resolution=resolution or "2k",
                         strength=strength, rotation=rotation)
    if t == "models":
        yol = polyhaven.model_indir(asset_id, resolution or "1k")
        return import_model(yol, name=asset_id, location=location)
    if t == "textures":
        yollar = polyhaven.doku_indir(asset_id, resolution or "2k")
        m = polyhaven.doku_materyali(asset_id, yollar, texture_scale)
        if apply_to:
            ob = _nesne(apply_to)
            if len(ob.data.materials):
                ob.data.materials[0] = m
            else:
                ob.data.materials.append(m)
        return {"materyal": m.name, "haritalar": sorted(yollar), "uygulanan": apply_to}
    raise ValueError("asset_type: hdris | models | textures")


# ================================================================== python

def execute_python(code):
    """Blender içinde Python çalıştırır. Sonuç döndürmek için 'sonuc' değişkenine ata."""
    import mathutils
    ad_alani = {"bpy": bpy, "C": bpy.context, "D": bpy.data, "mathutils": mathutils,
                "Vector": Vector, "math": math, "sonuc": None}
    cikti = io.StringIO()
    with contextlib.redirect_stdout(cikti):
        exec(compile(code, "<claude>", "exec"), ad_alani)
    s = ad_alani.get("sonuc")
    try:
        import json
        json.dumps(s)
    except (TypeError, ValueError):
        s = repr(s)
    return {"cikti": cikti.getvalue()[-8000:], "sonuc": s}


KOMUTLAR = {ad: fn for ad, fn in list(globals().items())
            if callable(fn) and not ad.startswith("_") and getattr(fn, "__module__", "") == __name__}
