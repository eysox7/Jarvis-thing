"""Puan harcama kuralları: izin ve nakit avans.

Kötüye kullanımı ("bir gün çalış, bir gün izin") önleyen sınırlar:

* İzin: bir takvim haftasında (Pazartesi–Pazar) en çok ``haftalik_max_saat``
  (varsayılan 8 saat = 1 gün). Sınır, iznin *kullanıldığı* güne göre işler;
  bakiyede ne kadar puan olursa olsun aşılamaz.
* Avans: bir takvim ayında en çok ``aylik_max_tl``.
* İkisi de puan bakiyesinden düşer; bakiye yetmezse reddedilir.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from math import ceil
from typing import Optional

from .storage import Depo


@dataclass
class IzinKurali:
    gun_basina_puan: int = 150        # 1 tam gün izin kaç puan (= 5 gün tavan puanı)
    gunluk_saat: float = 8.0
    haftalik_max_saat: float = 8.0    # haftada en çok 1 gün


@dataclass
class AvansKurali:
    acik: bool = True
    puan_basina_tl: float = 5.0       # 1 puan = 5 TL
    aylik_max_tl: float = 2000.0
    min_tl: float = 100.0


class KuralHatasi(ValueError):
    pass


def _tarih(t: Optional[str]) -> date:
    return date.fromisoformat(t) if t else date.today()


def hafta_araligi(g: date) -> tuple[str, str]:
    bas = g - timedelta(days=g.weekday())
    return bas.isoformat(), (bas + timedelta(days=6)).isoformat()


def ay_araligi(g: date) -> tuple[str, str]:
    bas = g.replace(day=1)
    son = (bas.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    return bas.isoformat(), son.isoformat()


def izin_maliyeti(saat: float, k: IzinKurali) -> int:
    return ceil(saat * k.gun_basina_puan / k.gunluk_saat)


def avans_maliyeti(tl: float, k: AvansKurali) -> int:
    return ceil(tl / k.puan_basina_tl)


def izin_al(depo: Depo, k: IzinKurali, isci: str, saat: float, tarih: Optional[str] = None) -> dict:
    g = _tarih(tarih)
    if saat <= 0:
        raise KuralHatasi("İzin süresi pozitif olmalı")
    if saat > k.gunluk_saat:
        raise KuralHatasi(f"Tek seferde en çok {k.gunluk_saat:g} saat izin alınabilir")
    bas, son = hafta_araligi(g)
    kullanilan = depo.kullanim_toplami(isci, "izin", bas, son)
    if kullanilan + saat > k.haftalik_max_saat:
        kalan = max(0.0, k.haftalik_max_saat - kullanilan)
        raise KuralHatasi(
            f"Haftalık izin sınırı: {bas} haftasında {isci} {kullanilan:g} saat kullanmış, "
            f"en çok {k.haftalik_max_saat:g} saat. O hafta kalan: {kalan:g} saat")
    puan = izin_maliyeti(saat, k)
    try:
        depo.harca(isci, "izin", puan, saat, g.isoformat(), f"{saat:g} saat izin ({g.isoformat()})")
    except ValueError as e:
        raise KuralHatasi(str(e)) from e
    return {"isci": isci, "saat": saat, "tarih": g.isoformat(), "puan": puan, "bakiye": depo.bakiye(isci)}


def avans_al(depo: Depo, k: AvansKurali, isci: str, tl: float, tarih: Optional[str] = None) -> dict:
    if not k.acik:
        raise KuralHatasi("Nakit avans kapalı")
    g = _tarih(tarih)
    if tl < k.min_tl:
        raise KuralHatasi(f"En az {k.min_tl:g} TL avans çekilebilir")
    bas, son = ay_araligi(g)
    kullanilan = depo.kullanim_toplami(isci, "avans", bas, son)
    if kullanilan + tl > k.aylik_max_tl:
        raise KuralHatasi(
            f"Aylık avans sınırı: {isci} bu ay {kullanilan:g} TL çekmiş, en çok {k.aylik_max_tl:g} TL. "
            f"Kalan: {max(0.0, k.aylik_max_tl - kullanilan):g} TL")
    puan = avans_maliyeti(tl, k)
    try:
        depo.harca(isci, "avans", puan, tl, g.isoformat(), f"{tl:g} TL nakit avans")
    except ValueError as e:
        raise KuralHatasi(str(e)) from e
    return {"isci": isci, "tl": tl, "tarih": g.isoformat(), "puan": puan, "bakiye": depo.bakiye(isci)}


def haklar(depo: Depo, ik: IzinKurali, ak: AvansKurali, isci: str, bakiye: int,
           bugun: Optional[date] = None) -> dict:
    """Bugün itibarıyla kişinin kullanabileceği izin saati ve avans TL'si (bakiye + limitler)."""
    g = bugun or date.today()
    hb, hs = hafta_araligi(g)
    ab, as_ = ay_araligi(g)
    hafta_kalan = max(0.0, ik.haftalik_max_saat - depo.kullanim_toplami(isci, "izin", hb, hs))
    bakiye_saat = int(max(0, bakiye) * ik.gunluk_saat / ik.gun_basina_puan) if ik.gun_basina_puan else 0
    ay_kalan = max(0.0, ak.aylik_max_tl - depo.kullanim_toplami(isci, "avans", ab, as_)) if ak.acik else 0.0
    bakiye_tl = max(0, bakiye) * ak.puan_basina_tl if ak.acik else 0.0
    return {
        "izin_saat_bakiye": bakiye_saat,                 # puanın karşılığı (toplam)
        "izin_saat_bu_hafta": min(bakiye_saat, hafta_kalan),
        "avans_tl_bakiye": bakiye_tl,
        "avans_tl_bu_ay": min(bakiye_tl, ay_kalan),
    }
