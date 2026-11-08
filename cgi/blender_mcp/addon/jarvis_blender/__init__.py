"""Jarvis Blender köprüsü.

Blender içinde 127.0.0.1:9876 üzerinde küçük bir JSON sunucusu açar. MCP
sunucusu (sunucu/jarvis_blender_mcp.py) buraya bağlanır ve Claude'un
komutlarını iletir.

Protokol: her satır bir JSON.
    istek : {"id": 1, "komut": "get_scene_info", "parametreler": {...}}
    cevap : {"id": 1, "ok": true, "sonuc": ...}
            {"id": 1, "ok": false, "hata": "...", "iz": "..."}

İki çalışma biçimi:
    Arayüzlü  : eklenti paneli (N → Jarvis) → "Sunucuyu başlat". Komutlar
                ana iş parçacığında bpy.app.timers ile çalışır, arayüz donmaz.
    Arayüzsüz : blender -b --python-expr "import jarvis_blender as j; j.calistir_bloklayan()"
                Sunucu ana iş parçacığını kullanır; render makinesi gibi.
"""

bl_info = {
    "name": "Jarvis Blender MCP",
    "author": "N.E.X.U.S.",
    "version": (1, 0, 0),
    "blender": (4, 2, 0),
    "location": "3D Görünüm → N paneli → Jarvis",
    "description": "Claude'un Blender'ı MCP üzerinden yönetmesi için yerel köprü",
    "category": "System",
}

import json
import os
import queue
import socket
import threading
import traceback

import bpy

VARSAYILAN_PORT = int(os.environ.get("JARVIS_BLENDER_PORT", "9876"))
HOST = "127.0.0.1"          # yalnızca bu bilgisayar; ağa açılmaz
CEVAP_ZAMAN_ASIMI = 900     # sn; uzun render'lar için


def _komutlar():
    from . import komutlar
    return komutlar


def isle(istek):
    """Tek bir isteği çalıştır, cevap sözlüğü döndür. Ana iş parçacığında çağrılmalı."""
    kid = istek.get("id")
    try:
        k = _komutlar()
        ad = istek.get("komut", "")
        fn = k.KOMUTLAR.get(ad)
        if fn is None:
            raise ValueError(f"bilinmeyen komut: {ad}. Mevcut: {', '.join(sorted(k.KOMUTLAR))}")
        sonuc = fn(**(istek.get("parametreler") or {}))
        if not bpy.app.background:
            try:
                bpy.ops.ed.undo_push(message=f"Jarvis: {ad}")
            except Exception:
                pass
        return {"id": kid, "ok": True, "sonuc": sonuc}
    except Exception as e:  # hata Claude'a geri gider, Blender çökmez
        return {"id": kid, "ok": False, "hata": f"{type(e).__name__}: {e}",
                "iz": traceback.format_exc(limit=4)}


def _satirlar(baglanti):
    tampon = b""
    while True:
        parca = baglanti.recv(65536)
        if not parca:
            return
        tampon += parca
        while b"\n" in tampon:
            satir, tampon = tampon.split(b"\n", 1)
            if satir.strip():
                yield satir


def _gonder(baglanti, cevap):
    baglanti.sendall((json.dumps(cevap, ensure_ascii=False, default=str) + "\n").encode("utf-8"))


def _soket(port):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind((HOST, port))
    s.listen(4)
    return s


# ------------------------------------------------------- arayüzlü (iş parçacıklı)

class _Sunucu:
    def __init__(self, port):
        self.port = port
        self.is_kuyrugu = queue.Queue()
        self.calisiyor = False
        self.soket = None

    def baslat(self):
        self.soket = _soket(self.port)
        self.soket.settimeout(1.0)
        self.calisiyor = True
        threading.Thread(target=self._kabul, daemon=True).start()
        bpy.app.timers.register(self._zamanlayici, persistent=True)
        print(f"[Jarvis] sunucu {HOST}:{self.port} dinliyor")

    def durdur(self):
        self.calisiyor = False
        if self.soket:
            self.soket.close()
        if bpy.app.timers.is_registered(self._zamanlayici):
            bpy.app.timers.unregister(self._zamanlayici)
        print("[Jarvis] sunucu durdu")

    def _kabul(self):
        while self.calisiyor:
            try:
                b, _ = self.soket.accept()
            except (socket.timeout, OSError):
                continue
            threading.Thread(target=self._istemci, args=(b,), daemon=True).start()

    def _istemci(self, b):
        with b:
            try:
                for satir in _satirlar(b):
                    try:
                        istek = json.loads(satir)
                    except json.JSONDecodeError as e:
                        _gonder(b, {"id": None, "ok": False, "hata": f"geçersiz JSON: {e}"})
                        continue
                    kutu = queue.Queue(maxsize=1)
                    self.is_kuyrugu.put((istek, kutu))
                    try:
                        cevap = kutu.get(timeout=CEVAP_ZAMAN_ASIMI)
                    except queue.Empty:
                        cevap = {"id": istek.get("id"), "ok": False, "hata": "zaman aşımı"}
                    _gonder(b, cevap)
            except OSError:
                pass

    def _zamanlayici(self):
        # Ana iş parçacığı: bpy burada güvenle kullanılır.
        for _ in range(8):
            try:
                istek, kutu = self.is_kuyrugu.get_nowait()
            except queue.Empty:
                break
            kutu.put(isle(istek))
        return 0.05 if self.calisiyor else None


_sunucu = None


def baslat(port=None):
    global _sunucu
    if _sunucu and _sunucu.calisiyor:
        return
    _sunucu = _Sunucu(port or VARSAYILAN_PORT)
    _sunucu.baslat()


def durdur():
    global _sunucu
    if _sunucu:
        _sunucu.durdur()
        _sunucu = None


def calisiyor_mu():
    return bool(_sunucu and _sunucu.calisiyor)


# ----------------------------------------------------------- arayüzsüz (bloklayan)

def calistir_bloklayan(port=None):
    """blender -b ile: ana iş parçacığında dinle. 'shutdown' komutu ile kapanır."""
    s = _soket(port or VARSAYILAN_PORT)
    print(f"[Jarvis] arayüzsüz sunucu {HOST}:{port or VARSAYILAN_PORT} dinliyor", flush=True)
    try:
        while True:
            b, _ = s.accept()
            with b:
                try:
                    for satir in _satirlar(b):
                        try:
                            istek = json.loads(satir)
                        except json.JSONDecodeError as e:
                            _gonder(b, {"id": None, "ok": False, "hata": f"geçersiz JSON: {e}"})
                            continue
                        if istek.get("komut") == "shutdown":
                            _gonder(b, {"id": istek.get("id"), "ok": True, "sonuc": "kapanıyor"})
                            return
                        _gonder(b, isle(istek))
                except OSError:
                    pass
    finally:
        s.close()


# ------------------------------------------------------------------- arayüz

class JARVIS_OT_baslat(bpy.types.Operator):
    bl_idname = "jarvis.sunucu_baslat"
    bl_label = "Sunucuyu başlat"

    def execute(self, context):
        try:
            baslat(context.preferences.addons[__package__].preferences.port
                   if __package__ in context.preferences.addons else None)
        except OSError as e:
            self.report({"ERROR"}, f"Port açılamadı: {e}")
            return {"CANCELLED"}
        return {"FINISHED"}


class JARVIS_OT_durdur(bpy.types.Operator):
    bl_idname = "jarvis.sunucu_durdur"
    bl_label = "Sunucuyu durdur"

    def execute(self, context):
        durdur()
        return {"FINISHED"}


class JARVIS_PT_panel(bpy.types.Panel):
    bl_label = "Jarvis MCP"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Jarvis"

    def draw(self, context):
        col = self.layout.column()
        if calisiyor_mu():
            col.label(text=f"Bağlı: {HOST}:{_sunucu.port}", icon="LINKED")
            col.operator("jarvis.sunucu_durdur", icon="PAUSE")
        else:
            col.label(text="Kapalı", icon="UNLINKED")
            col.operator("jarvis.sunucu_baslat", icon="PLAY")


class JarvisTercihler(bpy.types.AddonPreferences):
    bl_idname = __package__

    port: bpy.props.IntProperty(name="Port", default=VARSAYILAN_PORT, min=1024, max=65535)
    otomatik: bpy.props.BoolProperty(name="Blender açılınca sunucuyu başlat", default=True)

    def draw(self, context):
        self.layout.prop(self, "port")
        self.layout.prop(self, "otomatik")


_siniflar = (JARVIS_OT_baslat, JARVIS_OT_durdur, JARVIS_PT_panel, JarvisTercihler)


def _otomatik_baslat():
    try:
        t = bpy.context.preferences.addons[__package__].preferences
        if t.otomatik and not bpy.app.background:
            baslat(t.port)
    except Exception as e:
        print(f"[Jarvis] otomatik başlatılamadı: {e}")
    return None


def register():
    for c in _siniflar:
        bpy.utils.register_class(c)
    bpy.app.timers.register(_otomatik_baslat, first_interval=1.0)


def unregister():
    durdur()
    for c in reversed(_siniflar):
        bpy.utils.unregister_class(c)
