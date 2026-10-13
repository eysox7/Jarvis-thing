"""ANES (American National Election Studies) 2016 zaman serisinden karar modeli için değişken çıkarımı.
Kaynak: jamesmartherus/anesr (GitHub) — ANES kamu kullanım dosyası. Ham veri repoya konmaz;
çıktı tests/data/cache/ (gitignore) altına yazılır. Gerekli: pip install pyreadr
Kullanım: python3 tests/data/fetch_anes.py
"""
import os, sys, urllib.request
import pyreadr

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'cache'); os.makedirs(CACHE, exist_ok=True)
URL = 'https://raw.githubusercontent.com/jamesmartherus/anesr/master/data/timeseries_2016.rda'
rda = os.path.join(CACHE, 'timeseries_2016.rda')
if not os.path.exists(rda):
    urllib.request.urlretrieve(URL, rda)
d = pyreadr.read_r(rda)['timeseries_2016']

def g(c):
    return d[c]
cols = {
    'oy': 'V162034a',          # 1 Clinton 2 Trump 3 Johnson 4 Stein 5 diğer; -1 oy kullanmadı
    'oy_niyet': 'V161031',     # seçim öncesi niyet (aynı kodlama)
    'cocuk1': 'V162239', 'cocuk2': 'V162240', 'cocuk3': 'V162241', 'cocuk4': 'V162242',  # otoriterlik bataryası
    'ideoloji7': 'V161126', 'parti7': 'V161158x', 'din_onem': 'V161241', 'ibadet': 'V161245',
    'egitim_k': 'V161270', 'gelir28': 'V161361x', 'yas': 'V161267', 'cinsiyet_k': 'V161342', 'irk': 'V161310x',
    'hukumete_guven': 'V161215', 'ekonomi5': 'V161140x', 'term_clinton': 'V161086', 'term_trump': 'V161087',
}
out = d[list(cols.values())].copy(); out.columns = list(cols.keys())
out = out[out['oy'].isin([-1, 1, 2, 3, 4, 5])]
out.to_csv(os.path.join(CACHE, 'ANES2016.csv'), index=False)
print('ANES2016.csv', out.shape)
