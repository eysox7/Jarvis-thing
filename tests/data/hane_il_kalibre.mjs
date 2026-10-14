// Hane üreticisinin coğrafyasını GERÇEK il sonuçlarına kalibre eder: hedef yalnız 2023 YSK il payları
// (kayıtlı seçmene göre; tests/data/fetch_tr_il.py → real/tr_il_2023.csv). Her ile 5 bloğun fayda kayması eklenir ve
// yinelemeli olarak (sentetik il payı → gerçek il payı, örneklem büyüklüğüyle büzülmüş log-oran adımı) ayarlanır.
// Kişi düzeyi çarpanlar CSES kalibrasyonundan gelir (sentetik/hane_kal/kalibrasyon.json).
// Sınama (hedefe dokunmayan): (1) aynı kişilerin sentetik 2018 oyu ↔ gerçek 2018 il sonuçları;
// (2) başka tohumla üretilmiş yeni kişiler (örneklem gürültüsüne değil gerçek coğrafyaya uyuyor mu?).
// Çalıştır: node tests/data/hane_il_kalibre.mjs   → tests/data/sentetik/hane_kal_il/  (ters bölünme: KAYNAK=hane_kal_B)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { parseCSV } from '../../js/decision/data.js';

const GEN = new URL('./hayat_uret.mjs', import.meta.url).pathname;
// KAYNAK=hane_kal_B: ters bölünmenin kişi çarpanlarıyla (çıktı hane_kal_B_il/)
const KK = process.env.KAYNAK || 'hane_kal';
const KALF = new URL(`./sentetik/${KK}/kalibrasyon.json`, import.meta.url).pathname;
const OUT = new URL(`./sentetik/${KK}_il/`, import.meta.url).pathname;
const TMP = '/tmp/hane_il_' + process.pid; mkdirSync(TMP, { recursive: true });
const ALT = ['iktidar', 'ana_muhalefet', 'milliyetci', 'kurt_sol', 'oy_yok'];
const gercek = (yil) => Object.fromEntries(readFileSync(new URL(`./real/tr_il_${yil}.csv`, import.meta.url), 'utf8').trim().split('\n').slice(1)
  .map((l) => l.split(';')).map(([il, ...v]) => { const x = v.map(Number), t = x.reduce((a, b) => a + b, 0); return [il, x.map((y) => Math.max(y, 0.3) / t)]; }));
const R23 = gercek(2023), R18 = gercek(2018);

function uret(off, tohum = 2024, dir = TMP + '/out') {
  writeFileSync(TMP + '/il.json', JSON.stringify(off));
  execFileSync('node', [GEN, '1300', String(tohum)], { env: { ...process.env, HANE_KAL: KALF, HANE_IL: TMP + '/il.json', HANE_OUT: dir }, stdio: 'ignore' });
  return parseCSV(readFileSync(dir + '/TR_hane_secmen.csv', 'utf8'));
}
function ilPay(rows, col) {
  const o = {};
  for (const r of rows) { const e = (o[r.il] ||= { n: 0, c: ALT.map(() => 0) }); e.n++; e.c[ALT.indexOf(r[col])]++; }
  for (const e of Object.values(o)) e.p = e.c.map((c) => (c + 0.5) / (e.n + 2.5));
  return o;
}
// İl düzeyi uyum: yeterli kişisi olan illerde (n ≥ 20) her blok için korelasyon ve ortalama mutlak hata (puan)
function uyum(S, R) {
  const iller = Object.keys(S).filter((k) => S[k].n >= 20 && R[k]);
  return Object.fromEntries(ALT.map((a, j) => {
    const x = iller.map((k) => S[k].p[j]), y = iller.map((k) => R[k][j]), m = (v) => v.reduce((s, t) => s + t, 0) / v.length;
    const mx = m(x), my = m(y), cov = m(x.map((v, i) => (v - mx) * (y[i] - my))), sd = (v, mv) => Math.sqrt(m(v.map((t) => (t - mv) ** 2)));
    return [a, { r: +(cov / (sd(x, mx) * sd(y, my))).toFixed(2), mae: +(100 * m(x.map((v, i) => Math.abs(v - y[i])))).toFixed(1), n: iller.length }];
  }));
}
const yaz = (ad, u) => console.log(ad.padEnd(34), ALT.map((a) => `${a} r ${u[a].r} / ${u[a].mae}`).join(' | '), `(${u.iktidar.n} il)`);

let off = {}, eniyi = null;
const puan = (u) => ALT.reduce((a, k) => a + u[k].r, 0);
let rows = uret(off);
const eksik = [...new Set(rows.map((r) => r.il))].filter((k) => !R23[k]);
if (eksik.length) console.log('gerçek sonucu bulunmayan iller:', eksik.join(', '));
yaz('başlangıç 2023 (hedef)', uyum(ilPay(rows, 'secim'), R23));
yaz('başlangıç 2018 (sınama)', uyum(ilPay(rows, 'onceki'), R18));
yaz('başlangıç, tohum 7 2023', uyum(ilPay(uret(off, 7, TMP + '/t7'), 'secim'), R23));
for (let it = 1; it <= 8; it++) {
  const S = ilPay(rows, 'secim');
  for (const [il, e] of Object.entries(S)) {
    if (!R23[il]) continue;
    const w = 0.7 * e.n / (e.n + 40), d = ALT.map((_, j) => w * (Math.log(R23[il][j]) - Math.log(e.p[j]))), md = d.reduce((a, b) => a + b, 0) / 5;
    off[il] = (off[il] || ALT.map(() => 0)).map((v, j) => +(v + d[j] - md).toFixed(3));
  }
  rows = uret(off);
  const u = uyum(ilPay(rows, 'secim'), R23); yaz(`yineleme ${it} 2023 (hedef)`, u);
  if (!eniyi || puan(u) > eniyi.p) eniyi = { p: puan(u), off: structuredClone(off), it };
}
off = eniyi.off; rows = uret(off); console.log('seçilen yineleme', eniyi.it);
yaz('kalibre 2018 (sınama)', uyum(ilPay(rows, 'onceki'), R18));
yaz('kalibre, tohum 7 2023 (yeni kişiler)', uyum(ilPay(uret(off, 7, TMP + '/t7'), 'secim'), R23));

mkdirSync(OUT, { recursive: true });
writeFileSync(OUT + 'il_sabitleri.json', JSON.stringify(off, null, 1) + '\n');
writeFileSync(TMP + '/il.json', JSON.stringify(off));
execFileSync('node', [GEN], { env: { ...process.env, HANE_KAL: KALF, HANE_IL: TMP + '/il.json', HANE_OUT: OUT }, stdio: 'ignore' });
copyFileSync(KALF, OUT + 'kalibrasyon.json');
console.log('yazıldı:', OUT);
