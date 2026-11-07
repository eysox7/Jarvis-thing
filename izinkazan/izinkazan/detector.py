"""YOLO ile kişi tespiti + takip (ultralytics, ByteTrack).

Poz modeli (``*-pose.pt``) kullanılırsa bilek noktaları alınır; böylece "el iş
bölgesine girdi" tespit edilir. Düz tespit modelinde kutu merkezi kullanılır.
"""
from __future__ import annotations

from typing import Iterator, List, Tuple

from .counter import Person
from .geometry import bbox_anchor

# COCO-pose anahtar nokta indeksleri
SOL_BILEK, SAG_BILEK = 9, 10


class Dedektor:
    def __init__(self, model: str = "yolo11n-pose.pt", guven: float = 0.4, nokta: str = "bilek") -> None:
        try:
            from ultralytics import YOLO
        except ImportError as e:  # pragma: no cover
            raise SystemExit("ultralytics kurulu değil: pip install -r requirements.txt") from e
        self.model = YOLO(model)
        self.guven = guven
        self.nokta = nokta

    def akis(self, kaynak) -> Iterator[Tuple[float, List[Person], object]]:
        """(saniye, kişiler, çizilmiş kare) üretir. ``kaynak``: video yolu, kamera no ya da RTSP."""
        import cv2

        cap = cv2.VideoCapture(kaynak)
        if not cap.isOpened():
            raise SystemExit(f"Kaynak açılamadı: {kaynak}")
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        canli = isinstance(kaynak, int) or str(kaynak).startswith(("rtsp://", "http://", "https://"))
        import time
        t0 = time.monotonic()
        kare_no = 0
        try:
            while True:
                ok, kare = cap.read()
                if not ok:
                    break
                zaman = (time.monotonic() - t0) if canli else kare_no / fps
                kare_no += 1
                sonuc = self.model.track(kare, persist=True, classes=[0], conf=self.guven,
                                         tracker="bytetrack.yaml", verbose=False)[0]
                yield zaman, self._kisiler(sonuc), kare
        finally:
            cap.release()

    def _kisiler(self, sonuc) -> List[Person]:
        kutular = sonuc.boxes
        if kutular is None or kutular.id is None:
            return []
        ids = kutular.id.int().tolist()
        xyxy = kutular.xyxy.tolist()
        kps = None
        if self.nokta == "bilek" and getattr(sonuc, "keypoints", None) is not None:
            kps = sonuc.keypoints.data.tolist()  # [N, 17, 3] (x, y, güven)
        kisiler = []
        for i, (tid, kutu) in enumerate(zip(ids, xyxy)):
            noktalar = []
            if kps is not None:
                for k in (SOL_BILEK, SAG_BILEK):
                    x, y, c = kps[i][k]
                    if c >= 0.3:
                        noktalar.append((x, y))
            if not noktalar:
                noktalar = [bbox_anchor(kutu, "bottom" if self.nokta == "alt" else "center")]
            kisiler.append(Person(track_id=tid, noktalar=noktalar))
        return kisiler
