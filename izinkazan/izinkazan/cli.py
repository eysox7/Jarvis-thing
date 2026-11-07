"""İzinKazan komut satırı.

    python -m izinkazan izle    --ayar ayarlar.json --kaynak video.mp4 [--goster]
    python -m izinkazan puanla  --ayar ayarlar.json [--gun 2026-11-07]
    python -m izinkazan rapor   --ayar ayarlar.json [--gun ...]
    python -m izinkazan izin    --ayar ayarlar.json --isci Ayşe --saat 8 [--tarih 2026-11-13]
    python -m izinkazan avans   --ayar ayarlar.json --isci Ayşe --tl 500
    python -m izinkazan panel   --ayar ayarlar.json [--port 8000]
    python -m izinkazan bolge-ciz --kaynak video.mp4
    python -m izinkazan demo    [--ayar ayarlar.json]
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from datetime import date, datetime, timedelta

from . import config as cfg
from .counter import Person, WorkCounter
from . import odul
from .scoring import puanla
from .storage import Depo


def _kaynak(s: str):
    return int(s) if s.isdigit() else s


# --- izle ------------------------------------------------------------------
def komut_izle(a) -> None:
    from .detector import Dedektor

    ayar = cfg.yukle(a.ayar)
    depo = Depo(ayar.veritabani)
    sayac = WorkCounter(ayar.istasyonlar)
    dedektor = Dedektor(a.model or ayar.model, ayar.guven, ayar.nokta)
    baslangic = datetime.now()
    kaynak_adi = str(a.kaynak)
    cv2 = None
    if a.goster:
        import cv2  # noqa: F811

    def kaydet(olaylar):
        for o in olaylar:
            depo.is_ekle(o, baslangic + timedelta(seconds=o.bitis), kaynak_adi)
            print(f"[{o.bitis:8.1f}s] ✔ {o.istasyon}: {o.isci} ({o.sure:.1f} sn) → toplam {sayac.sayim[o.isci]}")

    try:
        for zaman, kisiler, kare in dedektor.akis(_kaynak(a.kaynak)):
            kaydet(sayac.guncelle(zaman, kisiler))
            if cv2 is not None:
                _ciz(cv2, kare, ayar.istasyonlar, sayac, kisiler)
                cv2.imshow("IzinKazan", kare)
                if cv2.waitKey(1) & 0xFF in (27, ord("q")):
                    break
    except KeyboardInterrupt:
        pass
    finally:
        kaydet(sayac.bitir())
        if cv2 is not None:
            cv2.destroyAllWindows()
        depo.kapat()
    print("\nOturum özeti:", json.dumps(sayac.sayim, ensure_ascii=False))
    if sayac.atilan:
        print(f"({sayac.atilan} döngü max_saniye'yi aştığı için iş sayılmadı)")


def _ciz(cv2, kare, istasyonlar, sayac, kisiler) -> None:
    import numpy as np

    for st in istasyonlar:
        renk = (0, 200, 0) if sayac.aktif_mi(st.ad) else (200, 200, 200)
        pts = np.array(st.bolge, dtype=np.int32)
        cv2.polylines(kare, [pts], True, renk, 2)
        isci = st.isci or "?"
        etiket = f"{st.ad} | {isci}: {sayac.sayim.get(isci, 0)}"
        x, y = pts[0]
        cv2.putText(kare, etiket, (int(x), int(y) - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.6, renk, 2)
    for k in kisiler:
        for (x, y) in k.noktalar:
            cv2.circle(kare, (int(x), int(y)), 5, (0, 140, 255), -1)
        x, y = k.noktalar[0]
        cv2.putText(kare, f"#{k.track_id}", (int(x) + 6, int(y)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 140, 255), 1)


# --- puanla / rapor ----------------------------------------------------------
def _tablo(ortalama, sonuclar, ayar) -> None:
    print(f"Ortalama: {ortalama:.2f} iş   (puan alma sınırı: > {ortalama * (1 + ayar.puan.esik):.2f})")
    print(f"{'Çalışan':<18}{'İş':>6}{'Oran':>8}{'Puan':>7}")
    for s in sonuclar:
        isaret = " ★" if s["puan"] > 0 else ""
        print(f"{s['isci']:<18}{s['is_sayisi']:>6}{s['oran']:>8.2f}{s['puan']:>7}{isaret}")


def komut_puanla(a) -> None:
    ayar = cfg.yukle(a.ayar)
    depo = Depo(ayar.veritabani)
    gun = a.gun or date.today().isoformat()
    ortalama, sonuclar = puanla(depo.gunluk_sayim(gun), ayar.puan, ayar.kadro)
    if not sonuclar or ortalama == 0:
        print(f"{gun} için iş kaydı yok.")
        return
    depo.donem_puanla(gun, ortalama, sonuclar)
    print(f"== {gun} puanlandı ==")
    _tablo(ortalama, [s.sozluk() for s in sonuclar], ayar)
    depo.kapat()


def komut_rapor(a) -> None:
    from .panel import ozet

    ayar = cfg.yukle(a.ayar)
    depo = Depo(ayar.veritabani)
    d = ozet(depo, ayar, a.gun)
    print(f"== {d['gun']} {'(kayıtlı)' if d['kaydedildi'] else '(önizleme — puanla ile kaydet)'} ==")
    _tablo(d["ortalama"], d["sonuclar"], ayar)
    print("\n== Bakiye ve kullanılabilir haklar ==")
    print(f"{'Çalışan':<18}{'Kazanılan':>10}{'Harcanan':>10}{'Bakiye':>8}{'İzin (bu hafta)':>17}{'Avans (bu ay)':>15}")
    for b in d["bakiyeler"]:
        print(f"{b['isci']:<18}{b['kazanilan']:>10}{b['kullanilan']:>10}{b['bakiye']:>8}"
              f"{b['izin_saat_bu_hafta']:>14g} sa{b['avans_tl_bu_ay']:>12,.0f} TL")
    depo.kapat()


def _harca(a, islem):
    ayar = cfg.yukle(a.ayar)
    depo = Depo(ayar.veritabani)
    try:
        sonuc = islem(depo, ayar)
    except odul.KuralHatasi as e:
        depo.kapat()
        sys.exit(f"Reddedildi: {e}")
    h = odul.haklar(depo, ayar.izin, ayar.avans, a.isci, sonuc["bakiye"], date.fromisoformat(sonuc["tarih"]))
    depo.kapat()
    return sonuc, h


def komut_izin(a) -> None:
    sonuc, h = _harca(a, lambda depo, ayar: odul.izin_al(depo, ayar.izin, a.isci, a.saat, a.tarih))
    print(f"✔ {a.isci}: {sonuc['tarih']} için {a.saat:g} saat izin, {sonuc['puan']} puan düşüldü. "
          f"Kalan bakiye {sonuc['bakiye']} puan.")
    print(f"  O hafta kalan izin hakkı: {h['izin_saat_bu_hafta']:g} saat")


def komut_avans(a) -> None:
    sonuc, h = _harca(a, lambda depo, ayar: odul.avans_al(depo, ayar.avans, a.isci, a.tl, a.tarih))
    print(f"✔ {a.isci}: {a.tl:,.0f} TL nakit avans, {sonuc['puan']} puan düşüldü. "
          f"Kalan bakiye {sonuc['bakiye']} puan.")
    print(f"  O ay kalan avans hakkı: {h['avans_tl_bu_ay']:,.0f} TL")


def komut_panel(a) -> None:
    from .panel import calistir

    calistir(cfg.yukle(a.ayar), a.host, a.port)


# --- bölge çizme --------------------------------------------------------------
def komut_bolge_ciz(a) -> None:
    import cv2

    cap = cv2.VideoCapture(_kaynak(a.kaynak))
    ok, kare = cap.read()
    cap.release()
    if not ok:
        sys.exit("Kaynaktan kare okunamadı")
    noktalar: list = []
    bolgeler: list = []

    def tik(olay, x, y, *_):
        if olay == cv2.EVENT_LBUTTONDOWN:
            noktalar.append([x, y])

    cv2.namedWindow("bolge")
    cv2.setMouseCallback("bolge", tik)
    print("Sol tık: nokta ekle · Enter: bölgeyi bitir · Backspace: son noktayı sil · q: çık")
    while True:
        goruntu = kare.copy()
        for b in bolgeler:
            cv2.polylines(goruntu, [__import__("numpy").array(b, dtype="int32")], True, (0, 200, 0), 2)
        for p in noktalar:
            cv2.circle(goruntu, tuple(p), 4, (0, 140, 255), -1)
        cv2.imshow("bolge", goruntu)
        t = cv2.waitKey(20) & 0xFF
        if t in (13, 10) and len(noktalar) >= 3:
            bolgeler.append(list(noktalar))
            noktalar.clear()
        elif t == 8 and noktalar:
            noktalar.pop()
        elif t in (ord("q"), 27):
            break
    cv2.destroyAllWindows()
    cikti = [{"ad": f"istasyon-{i + 1}", "isci": "", "bolge": b} for i, b in enumerate(bolgeler)]
    print(json.dumps({"istasyonlar": cikti}, ensure_ascii=False, indent=2))


# --- demo -----------------------------------------------------------------
def komut_demo(a) -> None:
    """YOLO olmadan sentetik hareket verisiyle uçtan uca akışı gösterir."""
    from .counter import Station
    from .config import Ayarlar

    if a.ayar:
        ayar = cfg.yukle(a.ayar)
    else:
        isimler = ["Ayşe", "Mehmet", "Zeynep", "Can", "Elif"]
        ayar = Ayarlar(
            istasyonlar=[Station(ad=f"masa-{i + 1}", isci=n, bolge=[(i * 200, 0), (i * 200 + 100, 0),
                                                                    (i * 200 + 100, 100), (i * 200, 100)])
                         for i, n in enumerate(isimler)],
            kadro=isimler, veritabani=a.db)
    rnd = random.Random(a.tohum)
    sayac = WorkCounter(ayar.istasyonlar)
    depo = Depo(ayar.veritabani)
    gun = date.today()
    baslangic = datetime.combine(gun, datetime.min.time()).replace(hour=8)
    # Her çalışanın farklı bir hızı var: döngü süresi (bölge içinde) + ara (bölge dışında)
    profil = {}
    for st in ayar.istasyonlar:
        profil[st.ad] = {"ic": rnd.uniform(2.0, 4.0), "dis": rnd.uniform(4.0, 14.0), "kalan": 0.0, "icerde": False}
    fps, sure = 10, a.dakika * 60
    for k in range(int(sure * fps)):
        t = k / fps
        kisiler = []
        for tid, st in enumerate(ayar.istasyonlar, start=1):
            p = profil[st.ad]
            p["kalan"] -= 1 / fps
            if p["kalan"] <= 0:
                p["icerde"] = not p["icerde"]
                p["kalan"] = (p["ic"] if p["icerde"] else p["dis"]) * rnd.uniform(0.8, 1.2)
            xs = [x for x, _ in st.bolge]
            ys = [y for _, y in st.bolge]
            cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
            nokta = (cx, cy) if p["icerde"] else (cx, max(ys) + 80)
            kisiler.append(Person(track_id=tid, noktalar=[nokta]))
        for o in sayac.guncelle(t, kisiler):
            depo.is_ekle(o, baslangic + timedelta(seconds=o.bitis), "demo")
    for o in sayac.bitir():
        depo.is_ekle(o, baslangic + timedelta(seconds=o.bitis), "demo")
    ortalama, sonuclar = puanla(depo.gunluk_sayim(gun.isoformat()), ayar.puan, ayar.kadro)
    depo.donem_puanla(gun.isoformat(), ortalama, sonuclar)
    print(f"Demo: {a.dakika} dakikalık sentetik vardiya işlendi → {ayar.veritabani}\n")
    _tablo(ortalama, [s.sozluk() for s in sonuclar], ayar)
    depo.kapat()


def ana(argv=None) -> None:
    p = argparse.ArgumentParser(prog="izinkazan", description="YOLO ile iş takibi ve ortalama üstü performansa puan")
    alt = p.add_subparsers(dest="komut", required=True)

    s = alt.add_parser("izle", help="Video/kamera üzerinde iş say")
    s.add_argument("--ayar", required=True)
    s.add_argument("--kaynak", required=True, help="video yolu, kamera no (0) veya rtsp:// adresi")
    s.add_argument("--model", help="ayardaki modeli geçersiz kıl (ör. yolo11s-pose.pt)")
    s.add_argument("--goster", action="store_true", help="görüntüyü ve bölgeleri pencerede göster")
    s.set_defaults(f=komut_izle)

    s = alt.add_parser("puanla", help="Bir günü puanla ve deftere yaz")
    s.add_argument("--ayar", required=True)
    s.add_argument("--gun")
    s.set_defaults(f=komut_puanla)

    s = alt.add_parser("rapor", help="Günlük tablo ve bakiyeler")
    s.add_argument("--ayar", required=True)
    s.add_argument("--gun")
    s.set_defaults(f=komut_rapor)

    s = alt.add_parser("izin", help="Puanla izin kullan (haftada en çok 1 gün)")
    s.add_argument("--ayar", required=True)
    s.add_argument("--isci", required=True)
    s.add_argument("--saat", type=float, required=True)
    s.add_argument("--tarih", help="izin günü (YYYY-MM-DD), varsayılan bugün")
    s.set_defaults(f=komut_izin)

    s = alt.add_parser("avans", help="Puanla nakit avans çek (aylık sınırlı)")
    s.add_argument("--ayar", required=True)
    s.add_argument("--isci", required=True)
    s.add_argument("--tl", type=float, required=True)
    s.add_argument("--tarih", help="avans tarihi (YYYY-MM-DD), varsayılan bugün")
    s.set_defaults(f=komut_avans)

    s = alt.add_parser("panel", help="Web panelini aç")
    s.add_argument("--ayar", required=True)
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8000)
    s.set_defaults(f=komut_panel)

    s = alt.add_parser("bolge-ciz", help="Kameradan bir kare alıp fareyle istasyon bölgesi çiz")
    s.add_argument("--kaynak", required=True)
    s.set_defaults(f=komut_bolge_ciz)

    s = alt.add_parser("demo", help="YOLO olmadan sentetik veriyle dene")
    s.add_argument("--ayar")
    s.add_argument("--db", default="izinkazan-demo.db")
    s.add_argument("--dakika", type=float, default=30)
    s.add_argument("--tohum", type=int, default=7)
    s.set_defaults(f=komut_demo)

    a = p.parse_args(argv)
    a.f(a)


if __name__ == "__main__":
    ana()
