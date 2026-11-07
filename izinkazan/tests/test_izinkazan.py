import json
import os
import tempfile
import unittest
from datetime import datetime

from izinkazan import odul
from izinkazan.config import yukle
from izinkazan.counter import Person, Station, WorkCounter
from izinkazan.geometry import point_in_polygon
from izinkazan.panel import ozet
from izinkazan.scoring import PuanKurali, Sonuc, izin_saati, puanla
from izinkazan.storage import Depo

KARE = [(0, 0), (10, 0), (10, 10), (0, 10)]


def kisi(tid, x, y):
    return [Person(track_id=tid, noktalar=[(x, y)])]


def oynat(sayac, adimlar, fps=10):
    """adimlar: [(saniye, iceride_mi)] → olay listesi"""
    olaylar, t = [], 0.0
    for sure, ic in adimlar:
        for _ in range(int(sure * fps)):
            olaylar += sayac.guncelle(t, kisi(1, 5, 5) if ic else kisi(1, 50, 50))
            t += 1 / fps
    return olaylar + sayac.bitir()


class Geometri(unittest.TestCase):
    def test_icinde_disinda(self):
        self.assertTrue(point_in_polygon((5, 5), KARE))
        self.assertFalse(point_in_polygon((15, 5), KARE))
        self.assertFalse(point_in_polygon((5, 5), KARE[:2]))


class Sayac(unittest.TestCase):
    def st(self, **kw):
        return Station(ad="m1", bolge=KARE, isci="Ayşe", **kw)

    def test_uc_dongu(self):
        s = WorkCounter([self.st()])
        olaylar = oynat(s, [(2, True), (3, False)] * 3)
        self.assertEqual(len(olaylar), 3)
        self.assertEqual(s.sayim, {"Ayşe": 3})

    def test_kisa_temas_sayilmaz(self):
        s = WorkCounter([self.st(min_saniye=1.0)])
        self.assertEqual(oynat(s, [(0.3, True), (2, False)]), [])

    def test_uzun_bekleme_sayilmaz(self):
        s = WorkCounter([self.st(max_saniye=10)])
        self.assertEqual(oynat(s, [(20, True), (2, False)]), [])
        self.assertEqual(s.atilan, 1)

    def test_kisa_kopma_tek_dongu(self):
        # tespitte 0.3 sn kopma, tolerans 0.7 → tek iş
        s = WorkCounter([self.st()])
        self.assertEqual(len(oynat(s, [(1.5, True), (0.3, False), (1.5, True), (2, False)])), 1)

    def test_atanmamis_istasyon_track_id(self):
        s = WorkCounter([Station(ad="m1", bolge=KARE)])
        oynat(s, [(2, True), (2, False)])
        self.assertEqual(s.sayim, {"kisi-1": 1})


class Puanlama(unittest.TestCase):
    def test_ortalama_ustu_puan(self):
        ort, ss = puanla({"A": 50, "B": 40, "C": 30})
        self.assertEqual(ort, 40)
        p = {s.isci: s.puan for s in ss}
        self.assertEqual(p, {"A": 18, "B": 0, "C": 0})  # 5 + 25*0.5 = 17.5 → 18

    def test_kadro_sifirlari_ortalamaya_dahil(self):
        ort, ss = puanla({"A": 30}, kadro=["A", "B", "C"])
        self.assertEqual(ort, 10)
        self.assertEqual({s.isci: s.puan for s in ss}["A"], 30)  # tavan

    def test_esik_ve_tek_kisi(self):
        # ortalama 40; 43 iş = %7.5 üstü, varsayılan %10 eşiğin altında
        _, ss = puanla({"A": 43, "B": 37})
        self.assertTrue(all(s.puan == 0 for s in ss))
        _, ss = puanla({"A": 43, "B": 37}, PuanKurali(esik=0.0))
        self.assertGreater(ss[0].puan, 0)
        _, ss = puanla({"A": 42})
        self.assertEqual(ss[0].puan, 0)

    def test_herkes_esit(self):
        _, ss = puanla({"A": 10, "B": 10})
        self.assertTrue(all(s.puan == 0 for s in ss))

    def test_izin_saati(self):
        self.assertEqual(izin_saati(150), 8)
        self.assertEqual(izin_saati(40), 2)
        self.assertEqual(izin_saati(-5), 0)


class DepoTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.db = os.path.join(self.dir.name, "t.db")

    def tearDown(self):
        self.dir.cleanup()

    def test_akis(self):
        d = Depo(self.db)
        s = WorkCounter([Station(ad="m1", bolge=KARE, isci="A"),
                         Station(ad="m2", bolge=[(20, 0), (30, 0), (30, 10), (20, 10)], isci="B")])
        t0 = datetime(2026, 11, 7, 8)
        for o in oynat(s, [(2, True), (3, False)] * 4):
            d.is_ekle(o, t0)
        self.assertEqual(d.gunluk_sayim("2026-11-07"), {"A": 4})

        ort, ss = puanla({"A": 60, "B": 40})
        d.donem_puanla("2026-11-07", ort, ss)
        d.donem_puanla("2026-11-07", ort, ss)  # tekrar puanlama çiftlemez
        self.assertEqual(d.bakiye("A"), 15)  # oran 1.2 → 5 + 10

        d.harca("A", "izin", 10, 1, "2026-11-09")
        self.assertEqual(d.bakiye("A"), 5)
        with self.assertRaises(ValueError):
            d.harca("A", "avans", 6, 30, "2026-11-09")
        d.kapat()

    def test_ayar_ve_panel(self):
        yol = os.path.join(os.path.dirname(__file__), "..", "ayarlar.ornek.json")
        ayar = yukle(yol)
        self.assertEqual(len(ayar.istasyonlar), 3)
        self.assertEqual(ayar.kadro, ["Ayşe", "Mehmet", "Zeynep"])
        ayar.veritabani = self.db
        d = Depo(self.db)
        json.dumps(ozet(d, ayar))  # boş veritabanında da çalışmalı
        d.kapat()


class Odul(unittest.TestCase):
    """Haftalık izin ve aylık avans sınırları."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.d = Depo(os.path.join(self.dir.name, "t.db"))
        # 1500 puan: limit olmasa 10 gün izne yeterdi
        self.d.donem_puanla("2026-11-01", 10, [Sonuc("A", 99, 2.0, 1500)])
        self.ik, self.ak = odul.IzinKurali(), odul.AvansKurali()

    def tearDown(self):
        self.d.kapat()
        self.dir.cleanup()

    def test_haftada_bir_gun(self):
        r = odul.izin_al(self.d, self.ik, "A", 8, "2026-11-10")      # Salı
        self.assertEqual(r["puan"], 150)
        with self.assertRaises(odul.KuralHatasi):                      # aynı hafta Cuma
            odul.izin_al(self.d, self.ik, "A", 1, "2026-11-13")
        odul.izin_al(self.d, self.ik, "A", 8, "2026-11-16")           # sonraki Pazartesi: olur
        self.assertEqual(self.d.bakiye("A"), 1200)

    def test_yarim_gunler_haftalik_toplama_sayilir(self):
        odul.izin_al(self.d, self.ik, "A", 4, "2026-11-09")
        odul.izin_al(self.d, self.ik, "A", 4, "2026-11-15")           # Pazar, aynı hafta
        with self.assertRaises(odul.KuralHatasi):
            odul.izin_al(self.d, self.ik, "A", 1, "2026-11-11")

    def test_tek_seferde_gunluk_saati_asamaz(self):
        with self.assertRaises(odul.KuralHatasi):
            odul.izin_al(self.d, self.ik, "A", 16, "2026-11-10")

    def test_bakiye_yetmezse_izin_yok(self):
        self.d.donem_puanla("2026-11-02", 10, [Sonuc("B", 20, 2.0, 100)])  # 150 gerekir
        with self.assertRaises(odul.KuralHatasi):
            odul.izin_al(self.d, self.ik, "B", 8, "2026-11-10")
        self.assertEqual(self.d.bakiye("B"), 100)

    def test_aylik_avans_siniri(self):
        r = odul.avans_al(self.d, self.ak, "A", 1500, "2026-11-05")
        self.assertEqual(r["puan"], 300)                               # 1500 / 5 TL
        with self.assertRaises(odul.KuralHatasi):
            odul.avans_al(self.d, self.ak, "A", 600, "2026-11-20")    # ay toplamı 2100 > 2000
        odul.avans_al(self.d, self.ak, "A", 500, "2026-11-20")
        odul.avans_al(self.d, self.ak, "A", 1000, "2026-12-01")       # yeni ay
        with self.assertRaises(odul.KuralHatasi):
            odul.avans_al(self.d, self.ak, "A", 50, "2026-12-02")     # min 100 TL

    def test_avans_kapali(self):
        with self.assertRaises(odul.KuralHatasi):
            odul.avans_al(self.d, odul.AvansKurali(acik=False), "A", 500)

    def test_haklar(self):
        from datetime import date
        odul.izin_al(self.d, self.ik, "A", 3, "2026-11-10")
        h = odul.haklar(self.d, self.ik, self.ak, "A", self.d.bakiye("A"), date(2026, 11, 12))
        self.assertEqual(h["izin_saat_bu_hafta"], 5)
        self.assertEqual(h["avans_tl_bu_ay"], 2000)

    def test_eski_veritabani_yukseltilir(self):
        import sqlite3
        yol = os.path.join(self.dir.name, "eski.db")
        db = sqlite3.connect(yol)
        db.executescript("""CREATE TABLE puanlar (id INTEGER PRIMARY KEY, donem TEXT NOT NULL,
            isci TEXT NOT NULL, is_sayisi INTEGER NOT NULL DEFAULT 0, ortalama REAL NOT NULL DEFAULT 0,
            puan INTEGER NOT NULL, aciklama TEXT, olusturma TEXT NOT NULL, UNIQUE(donem, isci));
            INSERT INTO puanlar (donem,isci,puan,olusturma) VALUES ('2026-11-01','A',50,'x'),
            ('izin:x','A',-12,'x');""")
        db.close()
        d = Depo(yol)
        self.assertEqual(d.bakiye("A"), 38)
        self.assertEqual(d.harcamalar()[0]["tur"], "izin")
        d.kapat()


if __name__ == "__main__":
    unittest.main()
