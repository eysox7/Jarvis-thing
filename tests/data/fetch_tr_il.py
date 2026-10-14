"""Türkiye 2018 ve 2023 milletvekili genel seçimlerinin GERÇEK il sonuçları (kaynak: YSK; derleyen
`turkeyelections` R paketi, MIT lisansı, CRAN). Ham paket tests/data/cache/ altına iner (gitignore);
çıktı: tests/data/real/tr_il_2015.csv (Kasım), tr_il_2018.csv, tr_il_2023.csv — modelin beş bloğuna, KAYITLI seçmen payı (%):
  iktidar        Cumhur İttifakı (AK Parti, MHP, Yeniden Refah, BBP + ittifaka verilen oylar)
  ana_muhalefet  CHP (+ Millet İttifakı'na verilen ortak oylar)
  milliyetci     İYİ Parti, Zafer Partisi (+ Ata İttifakı)
  kurt_sol       YSP/HDP, TİP (+ Emek ve Özgürlük İttifakı)
  oy_yok         sandığa gitmeyen + geçersiz oy (2018 dosyasında katılım yok: ülke geneli %86,2 kullanılır)
Diğer küçük partiler payları ölçeklenerek dağıtılmaz; toplam 100'e normalize edilir.
Kullanım: python3 tests/data/fetch_tr_il.py
"""
import os, tarfile, urllib.request, unicodedata
import pyreadr

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'cache'); os.makedirs(CACHE, exist_ok=True)
URL = 'https://cran.r-project.org/src/contrib/turkeyelections_0.1.4.tar.gz'
TAR = os.path.join(CACHE, 'turkeyelections_0.1.4.tar.gz')
if not os.path.exists(TAR):
    urllib.request.urlretrieve(URL, TAR)
DATA = os.path.join(CACHE, 'turkeyelections')
if not os.path.exists(DATA):
    with tarfile.open(TAR) as t:
        t.extractall(CACHE, members=[m for m in t.getmembers() if m.name.startswith('turkeyelections/data/') and m.name.endswith('.RData')], filter='data')

def read(n):
    return list(pyreadr.read_r(os.path.join(DATA, 'data', n + '.RData')).values())[0]

TR_LOWER = str.maketrans({'I': 'ı', 'İ': 'i'})
def il_adi(s):
    s = s.split('(')[0].split(' 1.')[0].split(' 2.')[0].split(' 3.')[0].split('-')[0].strip()
    s = s.translate(TR_LOWER).lower()
    return s[0].translate({ord('i'): 'İ', ord('ı'): 'I'}).upper() + s[1:]

def norm_key(s):
    return unicodedata.normalize('NFC', s)

out = {}
d = read('genel_secim_2023_il')
g = lambda r, *cs: sum(float(r.get(c, 0) or 0) for c in cs)
for _, r in d.iterrows():
    il = norm_key(il_adi(str(r['Il'])))
    if il.lower().startswith('yurt') or il.lower().startswith('gümrük') or il.lower().startswith('türkiye'):
        continue
    reg = float(r['Kayitli_Secmen_Sayisi'])
    v = {
        'iktidar': g(r, 'AK_Parti', 'MHP', 'YENIDEN_REFAH', 'BBP', 'CUMHUR_ITTIFAKI'),
        'ana_muhalefet': g(r, 'CHP', 'MILLET_ITTIFAKI'),
        'milliyetci': g(r, 'IYI_Parti', 'ZAFER_PARTISI', 'ATA_ITTIFAKI'),
        'kurt_sol': g(r, 'YESIL_SOL_PARTI', 'TIP', 'EMEK_VE_OZGURLUK_ITTIFAKI'),
    }
    valid = sum(v.values())
    v['oy_yok'] = reg - float(r['Oy_Kullanan_Secmen_Sayisi']) + (float(r['Oy_Kullanan_Secmen_Sayisi']) - float(r['Gecerli_Oy_Toplami']))
    acc = out.setdefault(il, {k: 0.0 for k in v})
    for k in v: acc[k] += v[k]
def write(path, rows):
    with open(path, 'w') as f:
        f.write('il;iktidar;ana_muhalefet;milliyetci;kurt_sol;oy_yok\n')
        for il, v in sorted(rows.items()):
            t = sum(v.values())
            f.write(il + ';' + ';'.join(f'{100 * v[k] / t:.1f}' for k in ['iktidar', 'ana_muhalefet', 'milliyetci', 'kurt_sol', 'oy_yok']) + '\n')
REAL = os.path.join(HERE, 'real')
write(os.path.join(REAL, 'tr_il_2023.csv'), out)

d18 = read('genel_secim_2018_il'); out18 = {}
for _, r in d18.iterrows():
    name = str(r['Il'])
    if '(I' in name or 'toplamı' in name: continue   # alt seçim bölgeleri; '(toplam)' satırı kullanılır
    il = norm_key(il_adi(name))
    f = lambda c: float(r.get(c, 0) or 0)
    v = {'iktidar': f('AK_Parti') + f('MHP'), 'ana_muhalefet': f('CHP'), 'milliyetci': f('IYI_Parti'), 'kurt_sol': f('HDP')}
    s = sum(v.values()); v = {k: x / s * 0.862 for k, x in v.items()}; v['oy_yok'] = 0.138
    out18[il] = v
write(os.path.join(REAL, 'tr_il_2018.csv'), out18)

# Kasım 2015 (iktidar = AK Parti; MHP o dönem muhalefette → milliyetçi muhalefet). Katılım ülke geneli %85,2
d15 = read('genel_secim_kasim_2015_il'); out15 = {}
for _, r in d15.iterrows():
    name = str(r['Il'])
    if '(I' in name or 'oplam' in name.lower() and '(toplam)' not in name.lower(): continue
    il = norm_key(il_adi(name))
    f = lambda c: float(r.get(c, 0) or 0)
    v = {'iktidar': f('AK_Parti'), 'ana_muhalefet': f('CHP'), 'milliyetci': f('MHP'), 'kurt_sol': f('HDP')}
    s = sum(v.values())
    if not s: continue
    v = {k: x / s * 0.852 for k, x in v.items()}; v['oy_yok'] = 0.148
    acc = out15.setdefault(il, {k: 0.0 for k in v}); w = 1.0
    for k in v: acc[k] = v[k]
write(os.path.join(REAL, 'tr_il_2015.csv'), out15)
print(len(out), 'il (2023);', len(out18), 'il (2018);', len(out15), 'il (2015)')
