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

# ---- ANES 2000: aynı ortak sütunlar + GERÇEK tartışma ağı bataryası (Huckfeldt & Sprague geleneği) ----
# Z1–Z24: siyaseti konuştuğu en çok 4 kişi; her biri için yakınlık (eş/akraba/akraba değil) ve
# "bu kişi seçimde kime oy verdi?" (yanıtlayıcının algısı). es_oyu = eş/partner olan kişinin oyu;
# ag_<seçenek> = eş dışındaki kişilerin oy payları; ag_n = oyu bilinen eş dışı kişi sayısı.
FIPS = {1: 'AL', 2: 'AK', 4: 'AZ', 5: 'AR', 6: 'CA', 8: 'CO', 9: 'CT', 10: 'DE', 11: 'DC', 12: 'FL', 13: 'GA', 15: 'HI', 16: 'ID', 17: 'IL',
        18: 'IN', 19: 'IA', 20: 'KS', 21: 'KY', 22: 'LA', 23: 'ME', 24: 'MD', 25: 'MA', 26: 'MI', 27: 'MN', 28: 'MS', 29: 'MO', 30: 'MT', 31: 'NE',
        32: 'NV', 33: 'NH', 34: 'NJ', 35: 'NM', 36: 'NY', 37: 'NC', 38: 'ND', 39: 'OH', 40: 'OK', 41: 'OR', 42: 'PA', 44: 'RI', 45: 'SC', 46: 'SD',
        47: 'TN', 48: 'TX', 49: 'UT', 50: 'VT', 51: 'VA', 53: 'WA', 54: 'WV', 55: 'WI', 56: 'WY'}

# Eyalet bağlamı: tests/data/real/eyalet_2000.csv — 2000 başkanlık seçiminin eyalet sonuçları (kamuya açık;
# kaynak: Wikipedia "2000 United States presidential election", Results by state tablosu)
def anes2000():
    d = load(2000)
    def g(c): return d[c]
    turn, pres = g('V001241'), g('V001249')
    sec = ['oy_yok' if t in (1, 2, 3) else ('dem' if v == 1 else 'rep' if v == 3 else 'ucuncu' if v in (2, 4, 5, 6, 7) else '') if t == 4 else ''
           for t, v in zip(turn, pres)]
    AUTH = [('V001586', 5), ('V001587', 1), ('V001588', 5), ('V001589', 5)]   # saygı, itaat, görgü, uslu olmak
    def auth(i):
        vals = [1.0 if g(c).iat[i] == a else 0.5 if g(c).iat[i] == 3 else 0.0 if g(c).iat[i] in (1, 5) else None for c, a in AUTH]
        vals = [x for x in vals if x is not None]
        return round(sum(vals) / len(vals), 3) if vals else ''
    imp, att = g('V000872'), g('V000879')
    din = [('dusuk' if i == 5 else ('yuksek' if a in (1, 2) else 'orta') if i == 1 else '') for i, a in zip(imp, att)]
    edu = [{1: 'ilkokul', 2: 'ilkokul', 3: 'lise', 4: 'lise', 5: 'lise', 6: 'universite', 7: 'lisansustu'}.get(e, '') for e in g('V000913')]
    inc = g('V000994').where(g('V000994').between(1, 22))
    q3, q3a, q3b = g('V000814'), g('V000815'), g('V000816')
    ek = [(1 if a == 1 else 2) if q == 1 else 3 if q == 5 else (5 if b == 1 else 4) if q == 3 else '' for q, a, b in zip(q3, q3a, q3b)]
    VOTE = {1: 'dem', 3: 'rep', 5: 'ucuncu', 7: 'oy_yok'}
    BLOK = [('V001703', 'V001710'), ('V001711', 'V001718'), ('V001719', 'V001726'), ('V001727', 'V001734')]
    es, agp, agn = [], [], []
    for i in range(len(d)):
        e, cnt = '', {}
        for rel, vt in BLOK:
            v = VOTE.get(int(g(vt).iat[i]))
            if not v: continue
            if g(rel).iat[i] == 1: e = v
            else: cnt[v] = cnt.get(v, 0) + 1
        n = sum(cnt.values())
        es.append(e); agn.append(n); agp.append({k: round(cnt.get(k, 0) / n, 3) for k in VOTE.values()} if n else None)
    term = lambda c: g(c).where(g(c).between(0, 100))
    out = pd.DataFrame({
        'secim': sec, 'otoriterlik': [auth(i) for i in range(len(d))],
        'ideoloji7': g('V000446').where(g('V000446').between(1, 7)),
        'parti7': (g('V000523') + 1).where(g('V000523').between(0, 6)),
        'dindarlik': din, 'egitim': edu, 'gelir_yuzdelik': inc.rank(pct=True).round(3),
        'yas': g('V000908').where(g('V000908') > 0), 'cinsiyet': g('V001029').map({1: 'erkek', 2: 'kadin'}),
        'beyaz': g('V001006a').map(lambda r: 1 if r == 50 else 0 if 0 < r < 88 else ''),
        'ilgi5': g('V000301').where(g('V000301') > 0),
        'guven5': g('V001534').map({1: 1, 2: 2, 3: 4, 4: 5}), 'ekonomi5': ek,
        'term_dem': term('V000360'), 'term_rep': term('V000361'), 'medya_sag': '', 'medya_sol': '',
        'eyalet': g('V000080').map(lambda x: FIPS.get(int(x), '')),
        'es_oyu': es, 'ag_n': agn,
    })
    for k in VOTE.values(): out['ag_' + k] = [x[k] if x else '' for x in agp]
    out = out[out['secim'] != '']
    out.to_csv(os.path.join(CACHE, 'ANES2000.csv'), index=False)
    print('ANES2000.csv', out.shape, out['secim'].value_counts().to_dict(), 'eş oyu bilinen', int((out['es_oyu'] != '').sum()), 'ağ bilinen', int((out['ag_n'] > 0).sum()))

if __name__ == '__main__':
    anes2000()
