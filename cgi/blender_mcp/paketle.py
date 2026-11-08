"""Blender eklentisini kurulabilir .zip yapar.

    python cgi/blender_mcp/paketle.py        →  cgi/blender_mcp/dist/jarvis_blender.zip

Blender → Edit → Preferences → Add-ons → (sağ üst ⌄) Install from Disk… → zip'i seç.
G870 render profili (cgi/blender/g870_profil.py) zip'in içine kopyalanır.
"""

import os
import zipfile

KOK = os.path.dirname(os.path.abspath(__file__))
KAYNAK = os.path.join(KOK, "addon", "jarvis_blender")
PROFIL = os.path.join(KOK, "..", "blender", "g870_profil.py")
HEDEF = os.path.join(KOK, "dist", "jarvis_blender.zip")


def paketle(hedef=HEDEF):
    os.makedirs(os.path.dirname(hedef), exist_ok=True)
    with zipfile.ZipFile(hedef, "w", zipfile.ZIP_DEFLATED) as z:
        for ad in sorted(os.listdir(KAYNAK)):
            if ad.endswith(".py"):
                z.write(os.path.join(KAYNAK, ad), f"jarvis_blender/{ad}")
        z.write(PROFIL, "jarvis_blender/g870_profil.py")
    return hedef


if __name__ == "__main__":
    print(paketle())
