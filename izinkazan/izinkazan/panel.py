"""Bağımlılıksız web paneli: puan tablosu, bakiyeler, son işler."""
from __future__ import annotations

import json
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from .config import Ayarlar
from .odul import haklar
from .scoring import puanla
from .storage import Depo

SAYFA = """<!doctype html><html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>İzinKazan</title>
<style>
:root{--bg:#f6f7f9;--kart:#fff;--yazi:#1c2430;--soluk:#667085;--cizgi:#e4e7ec;--vurgu:#0f766e;--alt:#b42318}
@media (prefers-color-scheme:dark){:root{--bg:#0f1318;--kart:#171c23;--yazi:#e6e9ee;--soluk:#98a2b3;--cizgi:#2a313b;--vurgu:#2dd4bf;--alt:#f97066}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--yazi);font:15px/1.45 system-ui,sans-serif}
main{max-width:960px;margin:0 auto;padding:16px}h1{font-size:22px;margin:4px 0 2px}p.alt{color:var(--soluk);margin:0 0 16px}
section{background:var(--kart);border:1px solid var(--cizgi);border-radius:10px;padding:14px;margin-bottom:14px;overflow-x:auto}
h2{font-size:16px;margin:0 0 10px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--cizgi);white-space:nowrap}
th{color:var(--soluk);font-weight:500;font-size:13px}.n{text-align:right;font-variant-numeric:tabular-nums}
.bar{height:8px;border-radius:4px;background:var(--cizgi);position:relative;min-width:120px}.bar i{position:absolute;inset:0 auto 0 0;border-radius:4px;background:var(--soluk)}
.ust i{background:var(--vurgu)}.puan{color:var(--vurgu);font-weight:600}.ozet{display:flex;gap:18px;flex-wrap:wrap;margin-bottom:10px;color:var(--soluk)}
.ozet b{color:var(--yazi);font-size:18px;display:block}select{font:inherit;padding:4px;background:var(--kart);color:var(--yazi);border:1px solid var(--cizgi);border-radius:6px}
</style></head><body><main>
<h1>İzinKazan</h1><p class="alt">YOLO ile iş takibi · ortalamanın üstüne çıkan puan kazanır · puan izne dönüşür</p>
<section><h2>Günlük tablo <select id="gun"></select></h2><div class="ozet" id="ozet"></div>
<table><thead><tr><th>Çalışan</th><th class="n">İş</th><th>Ortalamaya göre</th><th class="n">Oran</th><th class="n">Puan</th></tr></thead><tbody id="tablo"></tbody></table></section>
<section><h2>Puan bakiyesi ve haklar</h2><p class="alt" id="kural"></p><table><thead><tr><th>Çalışan</th><th class="n">Kazanılan</th><th class="n">Harcanan</th><th class="n">Bakiye</th><th class="n">İzin · bu hafta</th><th class="n">Avans · bu ay</th></tr></thead><tbody id="bakiye"></tbody></table></section>
<section><h2>Son harcamalar</h2><table><thead><tr><th>Tarih</th><th>Çalışan</th><th>Tür</th><th class="n">Miktar</th><th class="n">Puan</th></tr></thead><tbody id="harcama"></tbody></table></section>
<section><h2>Son işler</h2><table><thead><tr><th>Zaman</th><th>İstasyon</th><th>Çalışan</th><th class="n">Süre (sn)</th></tr></thead><tbody id="isler"></tbody></table></section>
</main><script>
const tl=v=>Number(v).toLocaleString('tr-TR',{maximumFractionDigits:0})+' TL',$=s=>document.querySelector(s),e=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
async function yukle(gun){const r=await fetch('/api/ozet'+(gun?'?gun='+gun:''));const d=await r.json();
const sel=$('#gun');sel.innerHTML=d.gunler.map(g=>`<option ${g===d.gun?'selected':''}>${g}</option>`).join('')||`<option>${d.gun}</option>`;
const mx=Math.max(1,...d.sonuclar.map(s=>s.is_sayisi));
$('#ozet').innerHTML=`<span><b>${d.toplam}</b>toplam iş</span><span><b>${d.ortalama.toFixed(1)}</b>ortalama</span><span><b>${d.sonuclar.filter(s=>s.puan>0).length}</b>puan alan</span>`+(d.kaydedildi?'':'<span><b>önizleme</b>henüz puanlanmadı</span>');
$('#tablo').innerHTML=d.sonuclar.map(s=>`<tr><td>${e(s.isci)}</td><td class=n>${s.is_sayisi}</td><td><div class="bar ${s.oran>1?'ust':''}"><i style="width:${s.is_sayisi/mx*100}%"></i></div></td><td class=n>${s.oran.toFixed(2)}</td><td class="n ${s.puan?'puan':''}">${s.puan||'–'}</td></tr>`).join('')||'<tr><td colspan=5>Bu gün için kayıt yok.</td></tr>';
$('#bakiye').innerHTML=d.bakiyeler.map(b=>`<tr><td>${e(b.isci)}</td><td class=n>${b.kazanilan}</td><td class=n>${b.kullanilan}</td><td class="n puan">${b.bakiye}</td><td class=n>${b.izin_saat_bu_hafta} saat</td><td class=n>${tl(b.avans_tl_bu_ay)}</td></tr>`).join('')||'<tr><td colspan=6>Henüz puan yok.</td></tr>';
const k=d.kurallar;$('#kural').textContent=`1 gün izin = ${k.gun_basina_puan} puan · haftada en çok ${k.haftalik_max_saat} saat izin`+(k.avans_acik?` · 1 puan = ${k.puan_basina_tl} TL · ayda en çok ${tl(k.aylik_max_tl)} avans`:' · avans kapalı');
$('#harcama').innerHTML=d.harcamalar.map(h=>`<tr><td>${e(h.kullanim_tarihi)}</td><td>${e(h.isci)}</td><td>${h.tur==='izin'?'İzin':'Avans'}</td><td class=n>${h.tur==='izin'?h.miktar+' saat':tl(h.miktar)}</td><td class=n>−${h.puan}</td></tr>`).join('')||'<tr><td colspan=5>Henüz harcama yok.</td></tr>';
$('#isler').innerHTML=d.isler.map(i=>`<tr><td>${e(i.zaman.replace("T"," "))}</td><td>${e(i.istasyon)}</td><td>${e(i.isci)}</td><td class=n>${i.sure}</td></tr>`).join('');}
$('#gun').onchange=ev=>yukle(ev.target.value);yukle();setInterval(()=>yukle($('#gun').value),10000);
</script></body></html>"""


def ozet(depo: Depo, ayar: Ayarlar, gun: str | None = None) -> dict:
    gunler = depo.gunler()
    gun = gun or (gunler[0] if gunler else date.today().isoformat())
    kayitli = depo.donem_sonuclari(gun)
    if kayitli:
        ortalama = kayitli[0]["ortalama"]
        sonuclar = [{"isci": r["isci"], "is_sayisi": r["is_sayisi"], "puan": r["puan"],
                     "oran": (r["is_sayisi"] / ortalama) if ortalama else 0.0} for r in kayitli]
    else:
        ortalama, ss = puanla(depo.gunluk_sayim(gun), ayar.puan, ayar.kadro)
        sonuclar = [s.sozluk() for s in ss]
    bakiyeler = depo.bakiyeler()
    for b in bakiyeler:
        b.update(haklar(depo, ayar.izin, ayar.avans, b["isci"], b["bakiye"]))
    return {
        "gun": gun, "gunler": gunler, "ortalama": ortalama, "kaydedildi": bool(kayitli),
        "toplam": sum(s["is_sayisi"] for s in sonuclar), "sonuclar": sonuclar,
        "bakiyeler": bakiyeler, "isler": depo.son_isler(30, gun),
        "harcamalar": depo.harcamalar(limit=20),
        "kurallar": {"gun_basina_puan": ayar.izin.gun_basina_puan, "haftalik_max_saat": ayar.izin.haftalik_max_saat,
                     "avans_acik": ayar.avans.acik, "puan_basina_tl": ayar.avans.puan_basina_tl,
                     "aylik_max_tl": ayar.avans.aylik_max_tl},
    }


def calistir(ayar: Ayarlar, host: str = "127.0.0.1", port: int = 8000) -> None:
    class Isleyici(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            url = urlparse(self.path)
            if url.path == "/":
                govde, tur = SAYFA.encode(), "text/html; charset=utf-8"
            elif url.path == "/api/ozet":
                gun = parse_qs(url.query).get("gun", [None])[0]
                depo = Depo(ayar.veritabani)
                try:
                    govde = json.dumps(ozet(depo, ayar, gun), ensure_ascii=False).encode()
                finally:
                    depo.kapat()
                tur = "application/json; charset=utf-8"
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", tur)
            self.send_header("Content-Length", str(len(govde)))
            self.end_headers()
            self.wfile.write(govde)

        def log_message(self, *a):
            pass

    sunucu = ThreadingHTTPServer((host, port), Isleyici)
    print(f"Panel: http://{host}:{port}  (Ctrl+C ile kapat)")
    try:
        sunucu.serve_forever()
    except KeyboardInterrupt:
        pass
