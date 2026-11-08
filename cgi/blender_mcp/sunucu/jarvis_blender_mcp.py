"""Jarvis Blender MCP sunucusu.

Claude (Desktop / Code) ↔ bu sunucu (stdio, MCP) ↔ Blender eklentisi (TCP 127.0.0.1:9876)

Çalıştırma:
    uv run --with mcp python jarvis_blender_mcp.py
    # ya da: pip install mcp && python jarvis_blender_mcp.py

Ortam değişkenleri:
    JARVIS_BLENDER_HOST  (varsayılan 127.0.0.1)
    JARVIS_BLENDER_PORT  (varsayılan 9876)
"""

import json
import os
import socket
import threading
from typing import Any, Literal, Optional

try:  # MCP Python SDK 2.x
    from mcp.server.mcpserver import Image, MCPServer as FastMCP
    from mcp.server.mcpserver.exceptions import ToolError
except ImportError:  # 1.x
    from mcp.server.fastmcp import FastMCP, Image
    from mcp.server.fastmcp.exceptions import ToolError

HOST = os.environ.get("JARVIS_BLENDER_HOST", "127.0.0.1")
PORT = int(os.environ.get("JARVIS_BLENDER_PORT", "9876"))

TALIMAT = """\
Bu araçlarla Blender'da sahne kurar, ışıklandırır, kamerayı yönetir ve render alırsın.
Donanım: Casper Excalibur G870, RTX 5050 Laptop (8 GB VRAM), 16 GB RAM.

Çalışma düzeni (her sahnede):
1. get_scene_info ile mevcut durumu gör; varsayım yapma.
2. Ölçek gerçek dünya metresidir (insan 1.8 m, masa 0.75 m, araba 4.5 m).
3. Fotogerçekçilik sırası: gerçek ışık (polyhaven HDRI ya da lighting_preset) →
   gerçek malzeme (set_material preset'leri, polyhaven dokuları; keskin kenarlara bevel) →
   fiziksel kamera (setup_camera: 35-85 mm, fstop 1.8-4 ile alan derinliği) →
   set_color_look('cinema').
4. Ortam/arka plan için milyonlarca poligon modelleme YAPMA: gerçek mekân gerekiyorsa
   import_gaussian_splat ile 3DGS taraması kullan; nesneler için polyhaven modelleri.
5. Her önemli adımdan sonra render_image(resolution_percentage=25-50, samples=16-64) ile
   bak, görüntüyü eleştir, düzelt. Son render'ı apply_render_profile('final' ya da
   'sinematik') ile al. Animasyonu render_animation ile arka planda başlat, job_status ile izle.
6. 8 GB VRAM: splat'larda max_points ≤ 1.5M, dokular 2k-4k, hacimsel sisi az kullan.
7. Hazır araç yetmiyorsa execute_python ile bpy kodu çalıştır (sonucu 'sonuc' değişkenine ata).
"""

mcp = FastMCP("blender", instructions=TALIMAT)


class Blender:
    """Eklentiye tek, kalıcı TCP bağlantısı; koparsa bir kez yeniden bağlanır."""

    def __init__(self):
        self.soket = None
        self.tampon = b""
        self.sayac = 0
        self.kilit = threading.Lock()

    def _baglan(self):
        try:
            self.soket = socket.create_connection((HOST, PORT), timeout=5)
        except OSError as e:
            raise ToolError(
                f"Blender'a bağlanılamadı ({HOST}:{PORT}). Blender açık mı ve "
                "N paneli → Jarvis → 'Sunucuyu başlat' tıklandı mı?") from e
        self.soket.settimeout(900)
        self.tampon = b""

    def _satir(self):
        while b"\n" not in self.tampon:
            parca = self.soket.recv(1 << 20)
            if not parca:
                raise ConnectionError("Blender bağlantıyı kapattı")
            self.tampon += parca
        satir, self.tampon = self.tampon.split(b"\n", 1)
        return json.loads(satir)

    def cagir(self, komut: str, **parametreler) -> Any:
        parametreler = {k: v for k, v in parametreler.items() if v is not None}
        with self.kilit:
            for deneme in range(2):
                try:
                    if self.soket is None:
                        self._baglan()
                    self.sayac += 1
                    istek = {"id": self.sayac, "komut": komut, "parametreler": parametreler}
                    self.soket.sendall((json.dumps(istek) + "\n").encode())
                    cevap = self._satir()
                    break
                except (ConnectionError, BrokenPipeError, ConnectionResetError, socket.timeout):
                    if self.soket:
                        self.soket.close()
                    self.soket = None
                    if deneme:
                        raise ToolError("Blender bağlantısı koptu; Blender çöktüyse yeniden aç.")
        if not cevap.get("ok"):
            # ToolError: hata metni modele ulaşır (diğer istisnalar SDK 2.x'te gizlenir).
            raise ToolError(f"Blender: {cevap.get('hata')}\n{cevap.get('iz', '')}".strip())
        return cevap.get("sonuc")


blender = Blender()


def _resimli(sonuc: dict, anahtar="onizleme"):
    yol = sonuc.get(anahtar)
    if yol and os.path.isfile(yol):
        return [json.dumps(sonuc, ensure_ascii=False), Image(path=yol)]
    return sonuc


Vec3 = list[float]

# ------------------------------------------------------------------- sahne


@mcp.tool()
def get_scene_info(limit: int = 200) -> dict:
    """Sahnenin özeti: motor, çözünürlük, kare aralığı, kamera, renk ayarı ve nesneler
    (ad, tür, konum, rotasyon°, ölçek, boyut m, materyaller). İşe her zaman bununla başla."""
    return blender.cagir("get_scene_info", limit=limit)


@mcp.tool()
def get_object_info(name: str) -> dict:
    """Tek nesnenin ayrıntısı: dünya merkezi, değiştiriciler, köşe/yüz sayısı, animasyon."""
    return blender.cagir("get_object_info", name=name)


@mcp.tool()
def clear_scene(keep_camera: bool = False, keep_lights: bool = False) -> dict:
    """Sahnedeki nesneleri siler (yeni bir çekime temiz başlamak için)."""
    return blender.cagir("clear_scene", keep_camera=keep_camera, keep_lights=keep_lights)


@mcp.tool()
def save_file(path: Optional[str] = None) -> dict:
    """.blend dosyasını kaydeder. İlk kayıtta path ver (ör. D:/Projeler/reklam/sahne.blend)."""
    return blender.cagir("save_file", path=path)


@mcp.tool()
def open_file(path: str) -> dict:
    """Var olan bir .blend dosyasını açar (kaydedilmemiş değişiklikler kaybolur)."""
    return blender.cagir("open_file", path=path)


# ---------------------------------------------------------------- nesneler


@mcp.tool()
def create_object(
    type: Literal["cube", "sphere", "ico_sphere", "cylinder", "cone", "plane", "monkey",
                  "torus", "text", "empty"] = "cube",
    name: Optional[str] = None, location: Vec3 = [0, 0, 0], rotation: Vec3 = [0, 0, 0],
    scale: Vec3 = [1, 1, 1], size: float = 1.0, text: Optional[str] = None,
    bevel: float = 0.0,
) -> dict:
    """Temel nesne ekler. size metre (küp kenarı, küre çapı). rotation derece.
    bevel > 0 (ör. 0.01) kenarları yuvarlatır: keskin kenar 'CGI' görünümünün ana nedeni.
    text türünde 'text' metni 3B yazı olur."""
    return blender.cagir("create_object", type=type, name=name, location=location,
                         rotation=rotation, scale=scale, size=size, text=text, bevel=bevel)


@mcp.tool()
def transform_object(name: str, location: Optional[Vec3] = None, rotation: Optional[Vec3] = None,
                     scale: Optional[list[float]] = None, look_at: Optional[Any] = None,
                     parent: Optional[str] = None) -> dict:
    """Taşı/döndür(°)/ölçekle. look_at: nesne adı ya da [x,y,z] — nesneyi oraya çevirir.
    parent: ebeveyn nesne adı ("" ebeveyni kaldırır)."""
    return blender.cagir("transform_object", name=name, location=location, rotation=rotation,
                         scale=scale, look_at=look_at, parent=parent)


@mcp.tool()
def duplicate_object(name: str, new_name: Optional[str] = None, location: Optional[Vec3] = None,
                     linked: bool = True) -> dict:
    """Kopyalar. linked=True veriyi paylaşır (bellek dostu: 100 ağaç = 1 ağaç belleği)."""
    return blender.cagir("duplicate_object", name=name, new_name=new_name, location=location,
                         linked=linked)


@mcp.tool()
def delete_objects(names: list[str]) -> dict:
    """Adı verilen nesneleri siler."""
    return blender.cagir("delete_objects", names=names)


@mcp.tool()
def keyframe_object(name: str, frame: int, location: Optional[Vec3] = None,
                    rotation: Optional[Vec3] = None, scale: Optional[Vec3] = None) -> dict:
    """Nesneye verilen karede anahtar kare koyar (animasyon). Kareler arası yumuşak geçer."""
    return blender.cagir("keyframe_object", name=name, frame=frame, location=location,
                         rotation=rotation, scale=scale)


@mcp.tool()
def import_model(path: str, name: Optional[str] = None, location: Optional[Vec3] = None,
                 scale: Optional[float] = None) -> dict:
    """Model içe aktarır: .glb/.gltf .fbx .obj .usd/.usdz .stl .abc .blend .ply.
    3DGS .ply/.splat dosyaları otomatik olarak Gaussian splat olarak eklenir."""
    return blender.cagir("import_model", path=path, name=name, location=location, scale=scale)


# ---------------------------------------------------------------- materyal


@mcp.tool()
def set_material(
    object: str,
    preset: Optional[Literal["altin", "krom", "fircalanmis_celik", "bakir", "cam", "buzlu_cam",
                             "su", "parlak_plastik", "mat_plastik", "kaucuk", "seramik",
                             "araba_boyasi", "deri", "kumas", "cilt", "mermer", "beton",
                             "neon"]] = None,
    color: Optional[str] = None, metallic: Optional[float] = None,
    roughness: Optional[float] = None, emission_color: Optional[str] = None,
    emission_strength: Optional[float] = None, transmission: Optional[float] = None,
    ior: Optional[float] = None, alpha: Optional[float] = None, coat: Optional[float] = None,
    subsurface: Optional[float] = None, name: Optional[str] = None,
) -> dict:
    """Fiziksel (Principled) materyal atar. color '#rrggbb'. preset verilirse temel
    alınır, diğer parametreler onu ezer. Gerçekçi işler için polyhaven dokularını tercih et."""
    return blender.cagir("set_material", object=object, preset=preset, color=color,
                         metallic=metallic, roughness=roughness, emission_color=emission_color,
                         emission_strength=emission_strength, transmission=transmission, ior=ior,
                         alpha=alpha, coat=coat, subsurface=subsurface, name=name)


# -------------------------------------------------------------------- ışık


@mcp.tool()
def lighting_preset(
    preset: Literal["three_point", "golden_hour", "studio", "noir", "neon", "moonlight",
                    "overcast"] = "three_point",
    target: Optional[Any] = None, strength: float = 1.0, clear_existing: bool = True,
) -> dict:
    """Sinema ışık düzeni kurar; mesafe ve güç sahne boyutuna göre ölçeklenir.
    three_point: klasik ana/dolgu/kontur. golden_hour: alçak sıcak güneş + gökyüzü.
    studio: ürün çekimi softbox. noir: tek sert ışık, karanlık. neon: pembe/camgöbeği.
    moonlight: soğuk gece. overcast: bulutlu, yumuşak gölgesiz. target: nesne adı ya da [x,y,z].
    Kurulu bir HDRI/gökyüzü varsa korunur; ışıklar onun üstüne eklenir."""
    return blender.cagir("lighting_preset", preset=preset, target=target, strength=strength,
                         clear_existing=clear_existing)


@mcp.tool()
def add_light(type: Literal["POINT", "SUN", "SPOT", "AREA"] = "AREA", name: Optional[str] = None,
              location: Vec3 = [4, -4, 5], target: Optional[Any] = None,
              rotation: Optional[Vec3] = None, energy: Optional[float] = None,
              color: str = "#ffffff", temperature: Optional[float] = None, size: float = 1.0,
              spot_angle: float = 45.0) -> dict:
    """Tek ışık. energy Watt (SUN için W/m², 1-10). temperature Kelvin (3200 tungsten,
    5600 gün ışığı, 7500 gölge) verilirse color yerine geçer. size büyüdükçe gölge yumuşar."""
    return blender.cagir("add_light", type=type, name=name, location=location, target=target,
                         rotation=rotation, energy=energy, color=color, temperature=temperature,
                         size=size, spot_angle=spot_angle)


@mcp.tool()
def set_world(hdri_path: Optional[str] = None, polyhaven_id: Optional[str] = None, sky: bool = False,
              strength: float = 1.0, rotation: float = 0.0, sun_elevation: float = 15.0,
              sun_rotation: float = 0.0, resolution: str = "2k",
              background_visible: bool = True) -> dict:
    """Ortam ışığı. HDRI (yerel yol ya da polyhaven_id) en hızlı fotogerçekçilik yoludur.
    sky=True fiziksel gökyüzü (sun_elevation derece). background_visible=False: ışık
    HDRI'dan gelir ama arka plan koyu kalır (ürün çekimi)."""
    return blender.cagir("set_world", hdri_path=hdri_path, polyhaven_id=polyhaven_id, sky=sky,
                         strength=strength, rotation=rotation, sun_elevation=sun_elevation,
                         sun_rotation=sun_rotation, resolution=resolution,
                         background_visible=background_visible)


@mcp.tool()
def world_color(color: str = "#101010", strength: float = 1.0) -> dict:
    """Düz renkli ortam (stüdyo arka planı)."""
    return blender.cagir("world_color", color=color, strength=strength)


@mcp.tool()
def add_atmosphere(density: float = 0.02, anisotropy: float = 0.6, color: str = "#ffffff",
                   remove: bool = False) -> dict:
    """Hacimsel sis: ışık hüzmeleri ve derinlik. density 0.005 (hafif) - 0.05 (yoğun)."""
    return blender.cagir("add_atmosphere", density=density, anisotropy=anisotropy, color=color,
                         remove=remove)


# ------------------------------------------------------------------ kamera


@mcp.tool()
def set_render_format(
    preset: Literal["fhd", "uhd", "qhd", "cinema_239", "cinema_239_4k", "cinema_185", "vertical",
                    "square", "portrait_45"] = "cinema_239",
    fps: int = 24, frame_start: Optional[int] = None, frame_end: Optional[int] = None,
    duration_seconds: Optional[float] = None, percentage: int = 100,
) -> dict:
    """Kadraj ve süre. cinema_239 = sinema geniş ekranı (1920x804). vertical = Reels/TikTok.
    duration_seconds verilirse son kare hesaplanır."""
    return blender.cagir("set_render_format", preset=preset, fps=fps, frame_start=frame_start,
                         frame_end=frame_end, duration_seconds=duration_seconds,
                         percentage=percentage)


@mcp.tool()
def setup_camera(name: str = "Kamera", location: Optional[Vec3] = None, target: Optional[Any] = None,
                 focal_length: float = 50.0, fstop: Optional[float] = None,
                 focus_target: Optional[Any] = None, sensor_width: float = 36.0,
                 shift_x: float = 0.0, shift_y: float = 0.0) -> dict:
    """Fiziksel kamera kurar ve hedefe çevirir. focal_length mm: 24 geniş/epik, 35 doğal,
    50 klasik, 85 portre/ürün, 135 sıkıştırılmış. fstop (1.4-2.8) alan derinliği açar;
    odak focus_target'a (yoksa target'a). location verilmezse kadrajı kendi hesaplar."""
    return blender.cagir("setup_camera", name=name, location=location, target=target,
                         focal_length=focal_length, fstop=fstop, focus_target=focus_target,
                         sensor_width=sensor_width, shift_x=shift_x, shift_y=shift_y)


@mcp.tool()
def camera_move(
    move: Literal["orbit", "push_in", "pull_out", "truck", "crane_up", "crane_down", "flyover",
                  "reveal", "static"] = "push_in",
    camera: Optional[str] = None, target: Optional[Any] = None,
    frame_start: Optional[int] = None, frame_end: Optional[int] = None,
    distance: Optional[float] = None, height: Optional[float] = None, angle: float = 90.0,
    amount: float = 0.4, shake: float = 0.0, ease: Literal["smooth", "linear"] = "smooth",
) -> dict:
    """Sinematik kamera hareketi (kamera hedefe kilitli kalır).
    orbit: hedef çevresinde 'angle'° döner. push_in/pull_out: yavaş yaklaş/uzaklaş (gerilim/açılış).
    truck: yana kayma (paralaks). crane_up/down: vinç. flyover: üstten geçiş. reveal: alçaktan
    yükselerek sahneyi açar. amount: hareket oranı. shake: el kamerası (0.02 hafif, 0.08 belirgin)."""
    return blender.cagir("camera_move", move=move, camera=camera, target=target,
                         frame_start=frame_start, frame_end=frame_end, distance=distance,
                         height=height, angle=angle, amount=amount, shake=shake, ease=ease)


@mcp.tool()
def set_color_look(look: Literal["cinema", "punchy", "natural", "soft", "filmic", "standard"] = "cinema",
                   exposure: Optional[float] = None, motion_blur: Optional[bool] = None,
                   shutter: float = 0.5) -> dict:
    """Renk dönüşümü/görünüm. cinema: AgX orta-yüksek kontrast. standard: Gaussian splat
    sahnelerinde en doğru renk. motion_blur=True + shutter 0.5 = 180° sinema obtüratörü."""
    return blender.cagir("set_color_look", look=look, exposure=exposure, motion_blur=motion_blur,
                         shutter=shutter)


# ------------------------------------------------------------------ render


@mcp.tool()
def apply_render_profile(profile: Literal["onizleme", "hizli", "final", "sinematik"] = "final") -> dict:
    """G870/RTX 5050 için ayarlı render profili. onizleme: hızlı Cycles kontrol.
    hizli: EEVEE (animasyon/sosyal, 10-50x hızlı). final: Cycles + OptiX denoise (still).
    sinematik: Cycles + hareket bulanıklığı + çok katmanlı EXR (Resolve için)."""
    return blender.cagir("apply_render_profile", profile=profile)


@mcp.tool()
def render_image(resolution_percentage: Optional[int] = 50, samples: Optional[int] = None,
                 frame: Optional[int] = None, engine: Optional[Literal["cycles", "eevee"]] = None,
                 output: Optional[str] = None):
    """Tek kare render alır ve görüntüyü döndürür (sana gösterilir). Kalıcı ayarları
    değiştirmez. Kontrol için 25-50% ve samples 16-64; son kare için 100% ve samples boş."""
    return _resimli(blender.cagir("render_image", resolution_percentage=resolution_percentage,
                                  samples=samples, frame=frame, engine=engine, output=output))


@mcp.tool()
def viewport_screenshot(max_px: int = 1280):
    """Blender arayüzündeki 3B görünümün ekran görüntüsü (render'dan çok daha hızlı)."""
    return _resimli(blender.cagir("viewport_screenshot", max_px=max_px))


@mcp.tool()
def render_animation(profile: Literal["onizleme", "hizli", "final", "sinematik"] = "hizli",
                     frame_start: Optional[int] = None, frame_end: Optional[int] = None,
                     output: Optional[str] = None) -> dict:
    """Animasyonu ayrı bir arka plan Blender sürecinde render eder; dosya önce kaydedilir.
    Kareler PNG/EXR dizisi olarak yazılır, yarıda kalırsa tekrar çağırmak kaldığı yerden sürdürür."""
    return blender.cagir("render_animation", profile=profile, frame_start=frame_start,
                         frame_end=frame_end, output=output)


@mcp.tool()
def job_status(job: Optional[int] = None) -> dict:
    """render_animation işinin ilerlemesi: biten kare, geçen ve tahmini kalan süre."""
    return blender.cagir("job_status", job=job)


# ---------------------------------------------------------- Gaussian splat


@mcp.tool()
def import_gaussian_splat(path: str, name: Optional[str] = None, max_points: int = 1_000_000,
                          min_opacity: float = 0.05, up_axis: Literal["-Y", "Y", "Z", "-Z"] = "-Y",
                          location: Vec3 = [0, 0, 0], scale: float = 1.0,
                          splat_size: float = 3.0, detail: Literal[1, 2] = 2) -> dict:
    """3D Gaussian Splatting taraması (.ply/.splat) ekler: telefonla çekilmiş gerçek bir
    mekân/nesne, poligon modellemeden fotogerçekçi ortam olur. Cycles ve EEVEE'de render edilir.
    max_points: 8 GB VRAM için ≤1.5M. up_axis: COLMAP tabanlı eğitimler -Y; ters görünürse Y.
    splat_size: sigma çarpanı, 3 = gerçek 3DGS (boşluklu görünürse büyüt, puslu görünürse küçült)."""
    return blender.cagir("import_gaussian_splat", path=path, name=name, max_points=max_points,
                         min_opacity=min_opacity, up_axis=up_axis, location=location, scale=scale,
                         splat_size=splat_size, detail=detail)


@mcp.tool()
def tune_splat(name: str, splat_size: Optional[float] = None, brightness: Optional[float] = None,
               show_in_viewport: Optional[bool] = None) -> dict:
    """Splat nesnesinin görünümünü ayarlar. show_in_viewport=False viewport'u hızlandırır
    (render'da yine görünür)."""
    return blender.cagir("tune_splat", name=name, splat_size=splat_size, brightness=brightness,
                         show_in_viewport=show_in_viewport)


# --------------------------------------------------------------- Poly Haven


@mcp.tool()
def polyhaven_search(asset_type: Literal["hdris", "models", "textures"] = "hdris", query: str = "",
                     category: Optional[str] = None, limit: int = 20) -> dict:
    """Poly Haven'da (ücretsiz, CC0, ticari serbest) HDRI/model/doku arar. query İngilizce
    anahtar kelimeler (ör. 'sunset', 'studio', 'chair', 'concrete'). Popülerliğe göre sıralı."""
    return blender.cagir("polyhaven_search", asset_type=asset_type, query=query,
                         category=category, limit=limit)


@mcp.tool()
def polyhaven_categories(asset_type: Literal["hdris", "models", "textures"] = "hdris") -> dict:
    """Poly Haven kategorileri ve varlık sayıları."""
    return blender.cagir("polyhaven_categories", asset_type=asset_type)


@mcp.tool()
def polyhaven_download(asset_id: str, asset_type: Literal["hdris", "models", "textures"] = "hdris",
                       resolution: Optional[str] = None, apply_to: Optional[str] = None,
                       location: Optional[Vec3] = None, texture_scale: float = 1.0,
                       strength: float = 1.0, rotation: float = 0.0) -> dict:
    """İndirir ve uygular: hdris → dünya ışığı; models → sahneye ekler; textures → apply_to
    nesnesine PBR materyal. resolution: '1k','2k','4k' (8 GB VRAM'de 2k-4k yeterli)."""
    return blender.cagir("polyhaven_download", asset_id=asset_id, asset_type=asset_type,
                         resolution=resolution, apply_to=apply_to, location=location,
                         texture_scale=texture_scale, strength=strength, rotation=rotation)


# ------------------------------------------------------------------ python


@mcp.tool()
def execute_python(code: str) -> dict:
    """Blender içinde bpy kodu çalıştırır (hazır araçların yetmediği her şey için).
    Sonuç döndürmek için 'sonuc' değişkenine ata; print çıktısı da döner.
    Hazır: bpy, C (context), D (data), mathutils, Vector, math."""
    return blender.cagir("execute_python", code=code)


@mcp.prompt()
def sinematik_cekim(konu: str, sure_saniye: int = 8, stil: str = "Hollywood reklam filmi") -> str:
    """Tek bir sinematik çekimi baştan sona kurdurur."""
    return f"""Blender'da "{konu}" için {sure_saniye} saniyelik, {stil} kalitesinde bir çekim kur.
1. get_scene_info → gerekiyorsa clear_scene.
2. set_render_format('cinema_239', fps=24, duration_seconds={sure_saniye}).
3. Ortam: gerçek mekân taraması varsa import_gaussian_splat; yoksa polyhaven HDRI + zemin.
4. Konu nesneleri: polyhaven modelleri, gerçekçi materyaller, kenarlarda bevel.
5. Işık: hikâyeye uygun lighting_preset; gerekirse add_atmosphere ile hafif sis.
6. setup_camera (35-85 mm, fstop 2-2.8) + camera_move (push_in, orbit ya da reveal; shake 0.01-0.02).
7. set_color_look('cinema', motion_blur=True).
8. apply_render_profile('onizleme') → render_image(25) ile 3 farklı karede (başlangıç/orta/son)
   kontrol et; kompozisyonu, ışığı, odağı eleştir ve düzelt.
9. Onaydan sonra apply_render_profile('hizli' ya da 'sinematik') → save_file → render_animation.
"""


def main():
    mcp.run()


if __name__ == "__main__":
    main()
