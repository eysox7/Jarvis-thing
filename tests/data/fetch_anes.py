"""ANES (American National Election Studies) 2016 ve 2020 zaman serilerinden karar modeli için
ortak (uyumlaştırılmış) değişken çıkarımı. Kaynak: jamesmartherus/anesr (GitHub) — ANES kamu
kullanım dosyaları. Ham veri repoya konmaz; çıktı tests/data/cache/ (gitignore) altına yazılır.
Gerekli: pip install pyreadr      Kullanım: python3 tests/data/fetch_anes.py

Ortak sütunlar (iki yılda aynı anlam):
  secim        dem | rep | ucuncu | oy_yok
  otoriterlik  0..1 — çocuk yetiştirme bataryası (Feldman & Stenner 1997; Adorno'nun F-ölçeğinin halefi)
  ideoloji7, parti7 (1 güçlü Demokrat .. 7 güçlü Cumhuriyetçi), dindarlik, egitim, gelir_yuzdelik,
  yas, cinsiyet, beyaz, guven5 (1 hükümete hep güvenir .. 5 hiç), ekonomi5 (1 çok iyileşti .. 5 çok kötüleşti),
  medya_sag, medya_sol (2020: partizan medya programı/site sayısı), ilgi5 (siyasete dikkat: 1 her zaman .. 5 hiç), term_dem, term_rep (aday termometreleri 0..100)
"""
import os, urllib.request
import pandas as pd
import pyreadr

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'cache'); os.makedirs(CACHE, exist_ok=True)
BASE = 'https://raw.githubusercontent.com/jamesmartherus/anesr/master/data/timeseries_{}.rda'

V = {
    2016: dict(vote='V162034a', turn=None, auth=[('V162239', 2), ('V162240', 2), ('V162241', 1), ('V162242', 2)],
               ideo='V161126', pid='V161158x', edu='V161270', inc='V161361x', age='V161267', sex='V161342',
               race='V161310x', att='V161003', trust='V161215', econ='V161140x', tdem='V161086', trep='V161087'),
    2020: dict(vote='V202073', turn='V202109x', auth=[('V202266', 2), ('V202267', 2), ('V202268', 1), ('V202269', 2)],
               ideo='V201200', pid='V201231x', edu='V201511x', inc='V202468x', age='V201507x', sex='V201600',
               race='V201549x', att='V201005', trust='V201233', econ='V201327x', tdem='V201151', trep='V201152'),
}

def load(y):
    f = os.path.join(CACHE, f'timeseries_{y}.rda')
    if not os.path.exists(f):
        urllib.request.urlretrieve(BASE.format(y), f)
    return list(pyreadr.read_r(f).values())[0]

def religiosity(y, d):
    if y == 2016:   # önem: 1 evet 2 hayır; ibadet 1 her hafta .. 5 hiç
        imp, att = d['V161241'], d['V161245']
        return [('dusuk' if i == 2 else ('yuksek' if a in (1, 2) else 'orta') if i == 1 else '') for i, a in zip(imp, att)]
    imp, att = d['V201433'], d['V201453']   # önem: 1 son derece .. 5 hiç
    return [('yuksek' if i in (1, 2) and a in (1, 2) else 'dusuk' if i in (4, 5) else 'orta' if i > 0 else '') for i, a in zip(imp, att)]

def education(y, e):
    if y == 2016:
        return 'ilkokul' if 1 <= e <= 8 else 'lise' if 9 <= e <= 12 else 'universite' if e == 13 else 'lisansustu' if 14 <= e <= 16 else ''
    return {1: 'ilkokul', 2: 'lise', 3: 'lise', 4: 'universite', 5: 'lisansustu'}.get(e, '')

for y, v in V.items():
    d = load(y)
    vote = d[v['vote']]
    if y == 2016:
        sec = vote.map(lambda x: 'dem' if x == 1 else 'rep' if x == 2 else 'ucuncu' if x in (3, 4, 5) else 'oy_yok' if x == -1 else '')
    else:
        t = d[v['turn']]
        sec = pd.Series(['oy_yok' if tt == 0 else ('dem' if x == 1 else 'rep' if x == 2 else 'ucuncu' if x in (3, 4, 5) else '') if tt == 1 else ''
                         for x, tt in zip(vote, t)], index=d.index)
    def auth_row(i):
        vals = []
        for c, a in v['auth']:
            x = d[c].iat[i]
            vals.append(1.0 if x == a else 0.5 if x == 3 else 0.0 if x in (1, 2) else None)
        vals = [x for x in vals if x is not None]
        return round(sum(vals) / len(vals), 3) if vals else ''
    inc = d[v['inc']].where(d[v['inc']] > 0)
    out = pd.DataFrame({
        'secim': sec,
        'otoriterlik': [auth_row(i) for i in range(len(d))],
        'ideoloji7': d[v['ideo']], 'parti7': d[v['pid']],
        'dindarlik': religiosity(y, d), 'egitim': [education(y, e) for e in d[v['edu']]],
        'gelir_yuzdelik': inc.rank(pct=True).round(3),
        'yas': d[v['age']].where(d[v['age']] > 0), 'cinsiyet': d[v['sex']].map({1: 'erkek', 2: 'kadin'}),
        'beyaz': d[v['race']].map(lambda r: 1 if r == 1 else 0 if r > 1 else ''),
        'ilgi5': d[v['att']].where(d[v['att']] > 0),
        'guven5': d[v['trust']].where(d[v['trust']] > 0), 'ekonomi5': d[v['econ']].where(d[v['econ']] > 0),
        'term_dem': d[v['tdem']].where(d[v['tdem']].between(0, 100)), 'term_rep': d[v['trep']].where(d[v['trep']].between(0, 100)),
    })
    # Medya diyeti (yalnız 2020): sağ = Hannity, Tucker Carlson, Fox & Friends, foxnews.com; sol = Rachel Maddow (MSNBC)
    if y == 2020:
        m = lambda c: (d[c] == 1).astype(int)
        out['medya_sag'] = m('V201630b') + m('V201630c') + m('V201631k') + m('V201634f')
        out['medya_sol'] = m('V201630d')
    else:
        out['medya_sag'] = ''; out['medya_sol'] = ''
    out['eyalet'] = d['V161010e'] if y == 2016 else ''   # 2020 kamu dosyasında eyalet gizli
    out = out[out['secim'] != '']
    out.to_csv(os.path.join(CACHE, f'ANES{y}.csv'), index=False)
    print(f'ANES{y}.csv', out.shape, out['secim'].value_counts().to_dict())
