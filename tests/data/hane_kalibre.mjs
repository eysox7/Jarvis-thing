// Hane üreticisini GERÇEK seçmen örüntüsüne kalibre eder: CSES Türkiye 2018'in yalnız A yarısının çapraz tabloları
// (oy | dindarlık, etnik köken, eğitim, ideoloji, yerleşim, cinsiyet) hedeftir; B yarısı sınama için dokunulmaz.
// Kayıp: koşullu payın marjinalden sapması ("kaldıraç") farkının karesi — anketin marjinal yanlılığından bağımsız.
// Üreticinin birkaç çarpanı (din, Kürt kimliği, Alevi kimliği, eğitim, otoriterlik, ideoloji öz-konumlaması, kadın
// milliyetçi oy) koordinat aramasıyla seçilir; sonuç tests/data/sentetik/hane_kal/ altına yazılır.
// Çalıştır: node tests/data/hane_kalibre.mjs   (önce python3 tests/data/fetch_cses_tr.py)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseCSV } from '../../js/decision/data.js';

const GEN = new URL('./hayat_uret.mjs', import.meta.url).pathname;
const TMP = '/tmp/hane_kal_' + process.pid; mkdirSync(TMP, { recursive: true });
const ALT = ['iktidar', 'ana_muhalefet', 'milliyetci', 'kurt_sol', 'oy_yok'];
const COLS = ['dindarlik', 'etnik_koken', 'egitim', 'ideoloji', 'yerlesim', 'cinsiyet'];
export const yarim = (kisi) => Number(String(kisi).split('-')[1]) % 2 === 0 ? 'A' : 'B';
const real = parseCSV(readFileSync(new URL('./cache/TR_CSES2018.csv', import.meta.url), 'utf8')).filter((r) => yarim(r.kisi) === 'A');

function lifts(rows, voteCol) {
  const N = rows.length, marg = ALT.map((a) => rows.filter((r) => r[voteCol] === a).length / N), out = {};
  for (const c of COLS) for (const v of [...new Set(rows.map((r) => r[c]).filter(Boolean))]) {
    const g = rows.filter((r) => r[c] === v); if (g.length < 15) continue;
    out[c + '=' + v] = { w: g.length / N, l: ALT.map((a, j) => g.filter((r) => r[voteCol] === a).length / g.length - marg[j]) };
  }
  return out;
}
const T = lifts(real, 'secim');
function loss(K) {
  writeFileSync(TMP + '/k.json', JSON.stringify(K));
  execFileSync('node', [GEN], { env: { ...process.env, HANE_KAL: TMP + '/k.json', HANE_OUT: TMP + '/out' }, stdio: 'ignore' });
  const syn = parseCSV(readFileSync(TMP + '/out/TR_hane_secmen.csv', 'utf8'));
  const S = lifts(syn, 'onceki');   // sentetik 2018 oyu
  let L = 0;
  for (const [k, t] of Object.entries(T)) { const s = S[k]; if (!s) continue; L += t.w * t.l.reduce((a, x, j) => a + (x - s.l[j]) ** 2, 0); }
  return L;
}
const GRID = { din: [0.3, 0.6, 1, 1.5, 2], kurt_ikt: [0, 0.4, 1], kurt_sol: [0.6, 0.8, 1], alevi: [0.5, 1, 1.5], egit: [0.5, 1, 2, 3], otoriter: [0.5, 1, 1.5], ideo: [0, 2, 4, 6, 8, 10], mill_kadin: [0, 0.5, 1, 1.5] };
let best = { din: 1, kurt_ikt: 1, kurt_sol: 1, alevi: 1, egit: 1, otoriter: 1, ideo: 0, mill_kadin: 0 }, bl = loss(best);
console.log('başlangıç kayıp', bl.toFixed(4));
for (let tur = 0; tur < 2; tur++) for (const [k, vals] of Object.entries(GRID)) {
  for (const v of vals) { if (v === best[k]) continue; const K = { ...best, [k]: v }, l = loss(K); if (l < bl) { bl = l; best = K; } }
  console.log(`tur ${tur + 1} ${k.padEnd(10)} → ${best[k]}  kayıp ${bl.toFixed(4)}`);
}
const OUT = new URL('./sentetik/hane_kal/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
writeFileSync(OUT + 'kalibrasyon.json', JSON.stringify(best, null, 1) + '\n');
execFileSync('node', [GEN], { env: { ...process.env, HANE_KAL: OUT + 'kalibrasyon.json', HANE_OUT: OUT }, stdio: 'inherit' });
console.log('en iyi', best, 'kayıp', bl.toFixed(4));
