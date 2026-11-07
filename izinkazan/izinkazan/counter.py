"""İş döngüsü sayacı.

Her istasyon (iş noktası) bir çokgen bölgedir. Bir "iş" şöyle tanımlanır:

    1. Takip edilen kişinin referans noktası (pozda bilek, yoksa kutu merkezi)
       bölgeye girer,
    2. bölgede en az ``min_saniye`` kalır,
    3. bölgeden çıkar ve ``cikis_toleransi`` saniye boyunca geri gelmez.

Süre ``max_saniye``'yi aşarsa bu bir iş döngüsü değil, bekleme/yaslanma
sayılır ve iş yazılmaz. Böylece bölgenin başında boş durmak puan getirmez.

Bölgeyi, her parça bitince elin bir kez girdiği yere çizin
(ör. bitmiş ürün kasası, pres tablası, paketleme bandı).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence

from .geometry import Point, point_in_polygon


@dataclass
class Station:
    ad: str
    bolge: List[Point]
    isci: Optional[str] = None          # istasyona atanmış çalışan
    min_saniye: float = 1.0
    max_saniye: float = 120.0
    cikis_toleransi: float = 0.7


@dataclass
class Person:
    """Bir karede tespit edilen kişi."""
    track_id: int
    noktalar: List[Point]               # bölge testi için noktalar (bilekler veya kutu merkezi)


@dataclass
class JobEvent:
    istasyon: str
    isci: str
    baslangic: float
    bitis: float
    track_id: int

    @property
    def sure(self) -> float:
        return self.bitis - self.baslangic


@dataclass
class _State:
    aktif_baslangic: Optional[float] = None
    son_gorulme: Optional[float] = None
    track_id: Optional[int] = None


@dataclass
class WorkCounter:
    istasyonlar: Sequence[Station]
    _durum: Dict[str, _State] = field(default_factory=dict)
    sayim: Dict[str, int] = field(default_factory=dict)
    atilan: int = 0                     # max_saniye'yi aşan (iş sayılmayan) döngüler

    def __post_init__(self) -> None:
        for s in self.istasyonlar:
            self._durum[s.ad] = _State()

    def _isci_adi(self, st: Station, track_id: int) -> str:
        return st.isci or f"kisi-{track_id}"

    def guncelle(self, zaman: float, kisiler: Sequence[Person]) -> List[JobEvent]:
        """Bir kareyi işler, tamamlanan işleri döndürür. ``zaman`` saniye cinsindendir."""
        olaylar: List[JobEvent] = []
        for st in self.istasyonlar:
            d = self._durum[st.ad]
            icerdeki = self._bolgedeki_kisi(st, kisiler, tercih=d.track_id)
            if icerdeki is not None:
                if d.aktif_baslangic is None:
                    d.aktif_baslangic = zaman
                    d.track_id = icerdeki
                d.son_gorulme = zaman
                continue
            if d.aktif_baslangic is not None and d.son_gorulme is not None:
                if zaman - d.son_gorulme >= st.cikis_toleransi:
                    olay = self._kapat(st, d)
                    if olay:
                        olaylar.append(olay)
        return olaylar

    def bitir(self) -> List[JobEvent]:
        """Video bittiğinde açık döngüleri kapatır."""
        olaylar = []
        for st in self.istasyonlar:
            d = self._durum[st.ad]
            if d.aktif_baslangic is not None:
                olay = self._kapat(st, d)
                if olay:
                    olaylar.append(olay)
        return olaylar

    def aktif_mi(self, istasyon: str) -> bool:
        return self._durum[istasyon].aktif_baslangic is not None

    @staticmethod
    def _bolgedeki_kisi(st: Station, kisiler: Sequence[Person], tercih: Optional[int]) -> Optional[int]:
        bulunan = None
        for k in kisiler:
            if any(point_in_polygon(p, st.bolge) for p in k.noktalar):
                if k.track_id == tercih:
                    return k.track_id
                if bulunan is None:
                    bulunan = k.track_id
        return bulunan

    def _kapat(self, st: Station, d: _State) -> Optional[JobEvent]:
        bas, son, tid = d.aktif_baslangic, d.son_gorulme, d.track_id
        d.aktif_baslangic = d.son_gorulme = d.track_id = None
        assert bas is not None and son is not None and tid is not None
        sure = son - bas
        if sure < st.min_saniye:
            return None
        if sure > st.max_saniye:
            self.atilan += 1
            return None
        isci = self._isci_adi(st, tid)
        self.sayim[isci] = self.sayim.get(isci, 0) + 1
        return JobEvent(istasyon=st.ad, isci=isci, baslangic=bas, bitis=son, track_id=tid)
