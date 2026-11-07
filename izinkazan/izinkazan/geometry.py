"""Basit geometri yardımcıları (bağımlılık yok)."""
from __future__ import annotations

from typing import Iterable, Sequence, Tuple

Point = Tuple[float, float]


def point_in_polygon(pt: Point, polygon: Sequence[Point]) -> bool:
    """Ray-casting ile noktanın çokgen içinde olup olmadığını döndürür."""
    x, y = pt
    inside = False
    n = len(polygon)
    if n < 3:
        return False
    j = n - 1
    for i in range(n):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        if (yi > y) != (yj > y):
            x_cross = (xj - xi) * (y - yi) / (yj - yi) + xi
            if x < x_cross:
                inside = not inside
        j = i
    return inside


def any_inside(points: Iterable[Point], polygon: Sequence[Point]) -> bool:
    return any(point_in_polygon(p, polygon) for p in points)


def bbox_anchor(bbox: Sequence[float], mode: str = "center") -> Point:
    """bbox = (x1, y1, x2, y2). mode: center | bottom."""
    x1, y1, x2, y2 = bbox
    if mode == "bottom":
        return ((x1 + x2) / 2.0, y2)
    return ((x1 + x2) / 2.0, (y1 + y2) / 2.0)
