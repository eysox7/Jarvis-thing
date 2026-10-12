// Tek kalıcılık katmanı: localStorage. Bu prototipte hiçbir veri cihazdan çıkmaz.
import { toast } from './util.js';

const KEY = 'influence.v1';

const defaults = () => ({
  v: 1,
  consent: null,      // { version, textHash, items: {process, share, files, adult}, at }
  profile: null,      // { name, code, hue, bio }
  answers: {},        // { d01: { c: 'A'|'B', ms, at } }
  docs: [],           // { id, name, kind, chunks: [str], style, at }
  clone: null,        // kendi klonun (clone.js → build)
  friends: [],        // içe aktarılan klon kartları
  battles: [],        // arena geçmişi
  settings: {
    engine: 'core',   // core | neural | hybrid
    backend: 'webllm',// webllm | server
    model: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    serverUrl: 'http://localhost:11434/v1',
    serverModel: 'qwen2.5:3b',
  },
});

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && d.v === 1) return { ...defaults(), ...d, settings: { ...defaults().settings, ...(d.settings || {}) } };
  } catch { /* bozuk kayıt: sıfırdan başla */ }
  return defaults();
}

export const S = load();

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
    return true;
  } catch {
    toast('Cihaz depolaması dolu — büyük dosyaları sil.', 'err');
    return false;
  }
}

export function wipe() {
  localStorage.removeItem(KEY);
  for (const k of Object.keys(S)) delete S[k];
  Object.assign(S, defaults());
}

export function storageBytes() {
  return (localStorage.getItem(KEY) || '').length * 2;
}
