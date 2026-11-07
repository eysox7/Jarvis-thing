import json
import os
import tempfile
import unittest
from datetime import datetime

from izinkazan.config import yukle
from izinkazan.counter import Person, Station, WorkCounter
from izinkazan.geometry import point_in_polygon
from izinkazan.panel import ozet
from izinkazan.scoring import PuanKurali, izin_saati, puanla
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
        self.assertEqual(p, {"A": 23, "B": 0, "C": 0})  # 10 + 25*0.5 = 22.5 → 23

    def test_kadro_sifirlari_ortalamaya_dahil(self):
        ort, ss = puanla({"A": 30}, kadro=["A", "B", "C"])
        self.assertEqual(ort, 10)
        self.assertEqual({s.isci: s.puan for s in ss}["A"], 50)  # tavan

    def test_esik_ve_tek_kisi(self):
        _, ss = puanla({"A": 42, "B": 38}, PuanKurali(esik=0.1))
        self.assertTrue(all(s.puan == 0 for s in ss))
        _, ss = puanla({"A": 42})
        self.assertEqual(ss[0].puan, 0)

    def test_herkes_esit(self):
        _, ss = puanla({"A": 10, "B": 10})
        self.assertTrue(all(s.puan == 0 for s in ss))

    def test_izin_saati(self):
        self.assertEqual(izin_saati(100), 8)
        self.assertEqual(izin_saati(30), 2)
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
        self.assertEqual(d.bakiye("A"), 20)

        d.izin_kullan("A", 10)
        self.assertEqual(d.bakiye("A"), 10)
        with self.assertRaises(ValueError):
            d.izin_kullan("A", 11)
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


if __name__ == "__main__":
    unittest.main()
