"""SQLite kayıtları: iş olayları ve puan defteri."""
from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime
from typing import Dict, List, Optional

from .counter import JobEvent
from .scoring import Sonuc

SEMA = """
CREATE TABLE IF NOT EXISTS isler (
    id        INTEGER PRIMARY KEY,
    tarih     TEXT NOT NULL,          -- YYYY-MM-DD (dönem)
    zaman     TEXT NOT NULL,          -- ISO zaman damgası
    istasyon  TEXT NOT NULL,
    isci      TEXT NOT NULL,
    sure      REAL NOT NULL,
    kaynak    TEXT
);
CREATE INDEX IF NOT EXISTS isler_tarih ON isler(tarih);

CREATE TABLE IF NOT EXISTS puanlar (
    id        INTEGER PRIMARY KEY,
    donem     TEXT NOT NULL,          -- puanlanan dönem (gün) ya da 'izin:<zaman>'
    isci      TEXT NOT NULL,
    is_sayisi INTEGER NOT NULL DEFAULT 0,
    ortalama  REAL NOT NULL DEFAULT 0,
    puan      INTEGER NOT NULL,       -- izin kullanımında negatif
    aciklama  TEXT,
    olusturma TEXT NOT NULL,
    UNIQUE(donem, isci)
);
"""


class Depo:
    def __init__(self, yol: str = "izinkazan.db") -> None:
        self.db = sqlite3.connect(yol)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SEMA)

    def kapat(self) -> None:
        self.db.close()

    # --- iş olayları -------------------------------------------------------
    def is_ekle(self, olay: JobEvent, gercek_zaman: datetime, kaynak: str = "") -> None:
        self.db.execute(
            "INSERT INTO isler (tarih, zaman, istasyon, isci, sure, kaynak) VALUES (?,?,?,?,?,?)",
            (gercek_zaman.date().isoformat(), gercek_zaman.isoformat(timespec="seconds"),
             olay.istasyon, olay.isci, round(olay.sure, 2), kaynak),
        )
        self.db.commit()

    def gunluk_sayim(self, tarih: str) -> Dict[str, int]:
        rows = self.db.execute(
            "SELECT isci, COUNT(*) n FROM isler WHERE tarih = ? GROUP BY isci", (tarih,))
        return {r["isci"]: r["n"] for r in rows}

    def gunler(self) -> List[str]:
        return [r[0] for r in self.db.execute("SELECT DISTINCT tarih FROM isler ORDER BY tarih DESC")]

    # --- puan defteri ------------------------------------------------------
    def donem_puanla(self, donem: str, ortalama: float, sonuclar: List[Sonuc]) -> None:
        """Aynı dönem tekrar puanlanırsa eski kayıtların yerine yazar."""
        simdi = datetime.now().isoformat(timespec="seconds")
        with self.db:
            self.db.execute("DELETE FROM puanlar WHERE donem = ?", (donem,))
            self.db.executemany(
                "INSERT INTO puanlar (donem, isci, is_sayisi, ortalama, puan, aciklama, olusturma)"
                " VALUES (?,?,?,?,?,?,?)",
                [(donem, s.isci, s.is_sayisi, round(ortalama, 2), s.puan,
                  f"oran {s.oran:.2f}", simdi) for s in sonuclar],
            )

    def izin_kullan(self, isci: str, puan: int, aciklama: str = "") -> None:
        if puan <= 0:
            raise ValueError("Kullanılacak puan pozitif olmalı")
        if self.bakiye(isci) < puan:
            raise ValueError(f"{isci} için yeterli puan yok (bakiye {self.bakiye(isci)})")
        simdi = datetime.now().isoformat(timespec="seconds")
        with self.db:
            self.db.execute(
                "INSERT INTO puanlar (donem, isci, puan, aciklama, olusturma) VALUES (?,?,?,?,?)",
                (f"izin:{simdi}:{uuid.uuid4().hex[:8]}", isci, -puan, aciklama or "izin kullanımı", simdi),
            )

    def bakiye(self, isci: str) -> int:
        r = self.db.execute("SELECT COALESCE(SUM(puan),0) FROM puanlar WHERE isci = ?", (isci,)).fetchone()
        return int(r[0])

    def bakiyeler(self) -> List[dict]:
        rows = self.db.execute(
            "SELECT isci,"
            " COALESCE(SUM(CASE WHEN puan > 0 THEN puan END),0) kazanilan,"
            " COALESCE(-SUM(CASE WHEN puan < 0 THEN puan END),0) kullanilan,"
            " SUM(puan) bakiye"
            " FROM puanlar GROUP BY isci ORDER BY bakiye DESC, isci")
        return [dict(r) for r in rows]

    def donem_sonuclari(self, donem: str) -> List[dict]:
        rows = self.db.execute(
            "SELECT isci, is_sayisi, ortalama, puan, aciklama FROM puanlar"
            " WHERE donem = ? ORDER BY is_sayisi DESC, isci", (donem,))
        return [dict(r) for r in rows]

    def son_isler(self, limit: int = 50, tarih: Optional[str] = None) -> List[dict]:
        if tarih:
            rows = self.db.execute(
                "SELECT zaman, istasyon, isci, sure FROM isler WHERE tarih = ? ORDER BY id DESC LIMIT ?",
                (tarih, limit))
        else:
            rows = self.db.execute(
                "SELECT zaman, istasyon, isci, sure FROM isler ORDER BY id DESC LIMIT ?", (limit,))
        return [dict(r) for r in rows]
