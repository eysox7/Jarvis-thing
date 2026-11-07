"""Ortalamaya göre puanlama.

Kural:
    ortalama = toplam iş / çalışan sayısı   (listedeki herkes dahil, 0 iş yapan da)
    oran     = kişinin işi / ortalama

    oran > 1 + esik   ise   puan = taban + (oran - 1) * 100 * katsayi   (tavan ile sınırlı)
    değilse                 puan = 0

Örnek (varsayılan: taban=5, katsayi=0.5, tavan=30, esik=0.10):
    ortalama 40 iş, Ayşe 50 iş → oran 1.25 (> 1.10) → 5 + 25*0.5 = 17.5 → 18 puan
    ortalama 40 iş, Can 43 iş  → oran 1.075 (< 1.10) → 0 puan
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Dict, Iterable, List, Optional


@dataclass
class PuanKurali:
    taban: float = 5.0        # eşiği geçen herkese verilen sabit puan
    katsayi: float = 0.5      # ortalamanın her %1 üstü için puan
    tavan: float = 30.0       # bir günde alınabilecek en yüksek puan
    esik: float = 0.10        # ortalamanın en az %10 üstü gerekir
    min_calisan: int = 2      # tek kişiyle ortalama anlamsız


@dataclass
class Sonuc:
    isci: str
    is_sayisi: int
    oran: float
    puan: int

    def sozluk(self) -> dict:
        return asdict(self)


def puanla(sayim: Dict[str, int], kural: Optional[PuanKurali] = None,
           kadro: Optional[Iterable[str]] = None) -> tuple[float, List[Sonuc]]:
    """(ortalama, sonuçlar) döndürür; sonuçlar iş sayısına göre azalan sıralıdır."""
    kural = kural or PuanKurali()
    isciler = dict.fromkeys(kadro or [], 0)
    isciler.update(sayim)
    if not isciler:
        return 0.0, []
    ortalama = sum(isciler.values()) / len(isciler)
    sonuclar: List[Sonuc] = []
    for isci, n in isciler.items():
        oran = n / ortalama if ortalama > 0 else 0.0
        puan = 0
        if len(isciler) >= kural.min_calisan and ortalama > 0 and oran > 1 + kural.esik:
            ham = kural.taban + (oran - 1) * 100 * kural.katsayi
            puan = int(min(kural.tavan, ham) + 0.5)
        sonuclar.append(Sonuc(isci=isci, is_sayisi=n, oran=round(oran, 3), puan=puan))
    sonuclar.sort(key=lambda s: (-s.is_sayisi, s.isci))
    return ortalama, sonuclar


def izin_saati(puan: int, gun_basina_puan: int = 150, gunluk_saat: float = 8.0) -> float:
    """Puanı izin saatine çevirir (tam saate yuvarlar, aşağı)."""
    if puan <= 0 or gun_basina_puan <= 0:
        return 0.0
    return float(int(puan * gunluk_saat / gun_basina_puan))
