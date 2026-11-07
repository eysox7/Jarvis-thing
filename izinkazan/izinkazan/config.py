"""Ayar dosyası (JSON) okuma."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import List

from .counter import Station
from .scoring import PuanKurali


@dataclass
class Ayarlar:
    istasyonlar: List[Station]
    kadro: List[str] = field(default_factory=list)
    puan: PuanKurali = field(default_factory=PuanKurali)
    model: str = "yolo11n-pose.pt"
    guven: float = 0.4
    nokta: str = "bilek"            # bilek | merkez | alt
    gun_basina_puan: int = 100
    gunluk_saat: float = 8.0
    veritabani: str = "izinkazan.db"


def yukle(yol: str) -> Ayarlar:
    with open(yol, encoding="utf-8") as f:
        ham = json.load(f)
    istasyonlar = []
    for s in ham.get("istasyonlar", []):
        bolge = [tuple(map(float, p)) for p in s["bolge"]]
        if len(bolge) < 3:
            raise ValueError(f"'{s.get('ad')}' istasyonunun bölgesi en az 3 nokta olmalı")
        istasyonlar.append(Station(
            ad=s["ad"], bolge=bolge, isci=s.get("isci"),
            min_saniye=float(s.get("min_saniye", 1.0)),
            max_saniye=float(s.get("max_saniye", 120.0)),
            cikis_toleransi=float(s.get("cikis_toleransi", 0.7)),
        ))
    if not istasyonlar:
        raise ValueError("Ayarlarda en az bir istasyon tanımlanmalı")
    kadro = list(ham.get("kadro") or [s.isci for s in istasyonlar if s.isci])
    izin = ham.get("izin", {})
    return Ayarlar(
        istasyonlar=istasyonlar,
        kadro=kadro,
        puan=PuanKurali(**ham.get("puan", {})),
        model=ham.get("model", "yolo11n-pose.pt"),
        guven=float(ham.get("guven", 0.4)),
        nokta=ham.get("nokta", "bilek"),
        gun_basina_puan=int(izin.get("gun_basina_puan", 100)),
        gunluk_saat=float(izin.get("gunluk_saat", 8.0)),
        veritabani=ham.get("veritabani", "izinkazan.db"),
    )
