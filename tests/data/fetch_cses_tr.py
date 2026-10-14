"""GERÇEK Türkiye seçmen verisi: CSES (Comparative Study of Electoral Systems) — Modül 4 Türkiye Kasım 2015
(n=1.086) ve Modül 5 Türkiye 2018 (n=1.069). Ücretsiz ve kayıtsız indirilir, atıf gerekir; açık yeniden
dağıtım izni olmadığı için ham ve türetilmiş bireysel dosyalar repoya KONMAZ (tests/data/cache/, gitignore).
Kaynak: https://cses.org — The Comparative Study of Electoral Systems (www.cses.org). CSES Module 4 Full
Release / CSES Module 5 Fourth Advance Release.
Çıktı (karar modelinin CSV şeması): tests/data/cache/TR_CSES2015.csv, TR_CSES2018.csv
  secim: iktidar (2015: AK Parti; 2018: Cumhur İttifakı = AK Parti + MHP) | ana_muhalefet (CHP) |
         milliyetci (2015: MHP; 2018: İYİ Parti) | kurt_sol (HDP) | oy_yok (sandığa gitmedi)
  Bölge bağlamı (NUTS-1, 12 bölge) gerçek il sonuçlarından: tests/data/real/tr_il_2015.csv / tr_il_2018.csv.
Kullanım: python3 tests/data/fetch_cses_tr.py
"""
import os, zipfile, urllib.request
import pyreadstat

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'cache', 'tr_raw'); os.makedirs(RAW, exist_ok=True)
SRC = {4: ('https://cses.org/wp-content/uploads/2019/03/cses4_stata.zip', 'cses4_stata/cses4.dta'),
       5: ('https://cses.org/wp-content/uploads/2023/07/cses5_stata.zip', 'cses5_stata/cses5.dta')}

def dta(mod):
    url, rel = SRC[mod]
    path = os.path.join(RAW, rel)
    if not os.path.exists(path):
        z = os.path.join(RAW, os.path.basename(url))
        if not os.path.exists(z): urllib.request.urlretrieve(url, z)
        with zipfile.ZipFile(z) as f: f.extractall(os.path.join(RAW, os.path.dirname(rel)))
        if not os.path.exists(path):   # zip içi klasör yapısı farklıysa .dta'yı bul
            for root, _, files in os.walk(os.path.join(RAW, os.path.dirname(rel))):
                for fn in files:
                    if fn.endswith('.dta'): return os.path.join(root, fn)
    return path

# NUTS-1 bölgeleri (CSES bölge kodu 1..12) ve illeri
NUTS = {
    1: ('istanbul', ['İstanbul']), 2: ('bati_marmara', ['Tekirdağ', 'Edirne', 'Kırklareli', 'Balıkesir', 'Çanakkale']),
    3: ('ege', ['İzmir', 'Aydın', 'Denizli', 'Muğla', 'Manisa', 'Afyonkarahisar', 'Kütahya', 'Uşak']),
    4: ('dogu_marmara', ['Bursa', 'Eskişehir', 'Bilecik', 'Kocaeli', 'Sakarya', 'Düzce', 'Bolu', 'Yalova']),
    5: ('bati_anadolu', ['Ankara', 'Konya', 'Karaman']), 6: ('akdeniz', ['Antalya', 'Isparta', 'Burdur', 'Adana', 'Mersin', 'Hatay', 'Kahramanmaraş', 'Osmaniye']),
    7: ('orta_anadolu', ['Kırıkkale', 'Aksaray', 'Niğde', 'Nevşehir', 'Kırşehir', 'Kayseri', 'Sivas', 'Yozgat']),
    8: ('bati_karadeniz', ['Zonguldak', 'Karabük', 'Bartın', 'Kastamonu', 'Çankırı', 'Sinop', 'Samsun', 'Tokat', 'Çorum', 'Amasya']),
    9: ('dogu_karadeniz', ['Trabzon', 'Ordu', 'Giresun', 'Rize', 'Artvin', 'Gümüşhane']),
    10: ('kuzeydogu_anadolu', ['Erzurum', 'Erzincan', 'Bayburt', 'Ağrı', 'Kars', 'Iğdır', 'Ardahan']),
    11: ('ortadogu_anadolu', ['Malatya', 'Elazığ', 'Bingöl', 'Tunceli', 'Van', 'Muş', 'Bitlis', 'Hakkari']),
    12: ('guneydogu_anadolu', ['Gaziantep', 'Adıyaman', 'Kilis', 'Şanlıurfa', 'Diyarbakır', 'Mardin', 'Batman', 'Şırnak', 'Siirt']),
}
ALT = ['iktidar', 'ana_muhalefet', 'milliyetci', 'kurt_sol', 'oy_yok']

def bolge_paylari(year):
    """NUTS-1 bölgesinin gerçek sonucu: illerin basit ortalaması (bölge içi nüfus ağırlığı yaklaşık)."""
    rows = {}
    with open(os.path.join(HERE, 'real', f'tr_il_{year}.csv'), encoding='utf8') as f:
        next(f)
        for line in f:
            p = line.strip().split(';'); rows[p[0]] = [float(x) for x in p[1:]]
    out = []
    for code, (ad, iller) in NUTS.items():
        v = [rows[i] for i in iller if i in rows]
        out.append([ad] + [round(sum(x[j] for x in v) / len(v), 1) for j in range(5)])
    with open(os.path.join(HERE, 'real', f'tr_bolge_{year}.csv'), 'w', encoding='utf8') as f:
        f.write('bolge;' + ';'.join(ALT) + '\n' + '\n'.join(';'.join(map(str, r)) for r in out) + '\n')

def egitim(e):   # ISCED
    return 'ilkokul' if e in (96, 1, 2, 3) else 'lise' if e in (4, 5) else 'universite' if e in (6, 7) else 'lisansustu' if e in (8, 9) else ''
def gelir(q): return {1: 'dusuk', 2: 'dusuk', 3: 'orta', 4: 'yuksek', 5: 'yuksek'}.get(q, '')
def dindar(a): return 'yuksek' if a in (5, 6) else 'orta' if a in (3, 4) else 'dusuk' if a in (1, 2) else ''
def ideo(x): return 'sol' if 0 <= x <= 3 else 'merkez' if 4 <= x <= 6 else 'sag' if 7 <= x <= 10 else ''
def yasb(y): return '' if not (18 <= y <= 100) else '18-24' if y < 25 else '25-34' if y < 35 else '35-44' if y < 45 else '45-54' if y < 55 else '55-64' if y < 65 else '65+'
def yerlesim(u): return {1: 'kirsal', 2: 'kent', 3: 'kent', 4: 'metropol'}.get(u, '')
def dil(l): return 'kurt' if l == 232 else 'arap' if l == 7 else 'turk' if l in (134, 231, 980, 981) else ''

def write(path, recs):
    cols = list(recs[0].keys())
    with open(path, 'w', encoding='utf8') as f:
        f.write(';'.join(cols) + '\n')
        for r in recs: f.write(';'.join('' if r[c] is None else str(r[c]) for c in cols) + '\n')

# ---- 2015 (Modül 4) ----
c4 = ['D1004', 'D2001_Y', 'D2002', 'D2003', 'D2020', 'D2024', 'D2027', 'D2028', 'D2031', 'D3003_1', 'D3003_2', 'D3003_3', 'D3005_LH', 'D3006_LH_PL', 'D3008_LH_PL', 'D3014', 'D3017', 'D3018_3']
d, _ = pyreadstat.read_dta(dta(4), usecols=c4)
d = d[d.D1004.astype(str) == 'TUR_2015']
V15 = {1: 'iktidar', 2: 'ana_muhalefet', 3: 'milliyetci', 4: 'kurt_sol'}
recs = []
for i, r in d.iterrows():
    sec = 'oy_yok' if r.D3005_LH in (5, 6) else V15.get(int(r.D3006_LH_PL)) if r.D3005_LH == 1 else None
    if not sec: continue
    e1 = int(r.D3003_1)
    eko = {1: (1.0 if r.D3003_2 == 1 else 0.5), 3: 0.0, 5: (-1.0 if r.D3003_3 == 5 else -0.5)}.get(e1)
    sat = {1: 'yuksek', 2: 'yuksek', 4: 'orta', 5: 'dusuk'}.get(int(r.D3017), '')
    recs.append({'kisi': 'TR15-%d' % i, 'secim': sec, 'yas': yasb(2015 - int(r.D2001_Y)), 'cinsiyet': {1: 'erkek', 2: 'kadin'}.get(int(r.D2002), ''),
        'egitim': egitim(int(r.D2003)), 'gelir': gelir(int(r.D2020)), 'dindarlik': dindar(int(r.D2024)), 'ideoloji': ideo(int(r.D3014)),
        'yerlesim': yerlesim(int(r.D2031)), 'etnik_koken': dil(int(r.D2027)), 'azinlik_kimlik': 'evet' if int(r.D2027) == 232 else 'hayir' if int(r.D2027) in (134, 7, 231) else '',
        'ekonomi_algisi': '' if eko is None else eko, 'kurumsal_guven': sat, 'siyasi_ilgi': '',
        'parti_yakinligi': {1: 'akp', 2: 'chp', 3: 'mhp', 4: 'hdp'}.get(int(r.D3018_3), 'yok'),
        'onceki': {1: 'iktidar', 2: 'ana_muhalefet', 3: 'milliyetci'}.get(int(r.D3008_LH_PL), ''),   # Haziran 2015 (HDP kodu ayrı yok → boş)
        'bolge': NUTS.get(int(r.D2028), ('', []))[0]})
write(os.path.join(HERE, 'cache', 'TR_CSES2015.csv'), recs)
print('2015:', len(recs), {a: sum(x['secim'] == a for x in recs) for a in ALT})

# ---- 2018 (Modül 5) ----
c5 = ['E1004', 'E2001_A', 'E2002', 'E2003', 'E2010', 'E2014', 'E2019', 'E2020', 'E2022', 'E3001', 'E3002', 'E3011', 'E3012_LH', 'E3013_LH_PL', 'E3020', 'E3023', 'E3024_3']
d, _ = pyreadstat.read_dta(dta(5), usecols=c5)
d = d[d.E1004.astype(str) == 'TUR_2018']
V18 = {792001: 'iktidar', 792004: 'iktidar', 792002: 'ana_muhalefet', 792005: 'milliyetci', 792003: 'kurt_sol'}
recs = []
for i, r in d.iterrows():
    v = int(r.E3013_LH_PL)
    sec = 'oy_yok' if v == 999999 or r.E3012_LH == 0 else V18.get(v)
    if not sec: continue
    eko = {1: 1.0, 2: 0.5, 3: 0.0, 4: -0.5, 5: -1.0}.get(int(r.E3011))
    ilgi = {1: 1.0, 2: 0.67, 3: 0.33, 4: 0.0}.get(int(r.E3001)); takip = {1: 1.0, 2: 0.67, 3: 0.33, 4: 0.0}.get(int(r.E3002))
    si = None if ilgi is None and takip is None else round(sum(x for x in (ilgi, takip) if x is not None) / len([x for x in (ilgi, takip) if x is not None]), 2)
    sat = {1: 'yuksek', 2: 'yuksek', 4: 'orta', 5: 'dusuk'}.get(int(r.E3023), '')
    pid = {792001: 'akp', 792002: 'chp', 792003: 'hdp', 792004: 'mhp', 792005: 'iyi'}.get(int(r.E3024_3), 'yok')
    recs.append({'kisi': 'TR18-%d' % i, 'secim': sec, 'yas': yasb(int(r.E2001_A)), 'cinsiyet': {1: 'erkek', 2: 'kadin'}.get(int(r.E2002), ''),
        'egitim': egitim(int(r.E2003)), 'gelir': gelir(int(r.E2010)), 'dindarlik': dindar(int(r.E2014)), 'ideoloji': ideo(int(r.E3020)),
        'yerlesim': yerlesim(int(r.E2022)), 'etnik_koken': dil(int(r.E2019)), 'azinlik_kimlik': 'evet' if int(r.E2019) == 232 else 'hayir' if int(r.E2019) in (134, 7, 980, 981) else '',
        'ekonomi_algisi': '' if eko is None else eko, 'kurumsal_guven': sat, 'siyasi_ilgi': '' if si is None else si,
        'parti_yakinligi': pid, 'onceki': '', 'bolge': NUTS.get(int(r.E2020), ('', []))[0]})
write(os.path.join(HERE, 'cache', 'TR_CSES2018.csv'), recs)
print('2018:', len(recs), {a: sum(x['secim'] == a for x in recs) for a in ALT})
for y in (2015, 2018): bolge_paylari(y)
