// Kalıcı yerel depo (localStorage). Tüm veri cihazda kalır.
import { uid } from './util.js';

const KEY = 'nexus.v1';

const DEFAULTS = {
  version: 1,
  settings: {
    userName: '',
    persona: '',
    maxSteps: 8,
    temperature: 0.4,
    autoApprove: false,
    stream: true,
    tts: false,
    lang: 'tr-TR',
    handsFree: false,      // açılışta eller serbest modu başlat
    requireWake: true,     // uyandırma kelimesi şart mı
    wakeWord: 'nexus',
    bargeIn: false,        // konuşurken de dinle
    voiceRate: 1.05,
    proxy: '',
    searchProvider: '',
    searchKey: '',
    activeProfile: '',
  },
  profiles: [],   // {id,name,provider,baseUrl,apiKey,model,extraHeaders,enabled}
  tasks: [],      // {id,title,notes,due,priority,status,createdAt,doneAt}
  notes: [],      // {id,title,body,updatedAt}
  memory: {},     // {anahtar: değer}
  reminders: [],  // {id,at,message,fired}
  chat: [],       // {role,content,ts}
  audience: {     // kitle tahmini: kurumun kendi profilleri ve kalibrasyonları
    institutions: {},   // {id: kurum profili}
    calibration: {},    // {kurum_id | '_genel': {weights, intercepts, fit}}
  },
  decision: {     // karar tahmini: senaryolar, veri setleri, öğrenilmiş modeller
    scenarios: {},      // {id: {alan, secenekler, baglam, ad}}
    datasets: {},       // {senaryo_id: {rows, uyarilar, eslesen_boyutlar, at}}
    models: {},         // {senaryo_id: model (theta, asc, demo, cv, kuramlar, topluluk?)}
  },
};

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(DEFAULTS),
      ...parsed,
      settings: { ...DEFAULTS.settings, ...(parsed.settings || {}) },
      audience: { ...structuredClone(DEFAULTS.audience), ...(parsed.audience || {}) },
      decision: { ...structuredClone(DEFAULTS.decision), ...(parsed.decision || {}) },
    };
  } catch (e) {
    console.warn('depo okunamadı, sıfırlanıyor', e);
    return structuredClone(DEFAULTS);
  }
}

let saveTimer = null;

function write() {
  saveTimer = null;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.error('kayıt başarısız (kota dolmuş olabilir)', e);
    // Sohbeti kırpıp bir daha dene.
    state.chat = state.chat.slice(-40);
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* pes */ }
  }
  listeners.forEach((fn) => fn(state));
}

/** Yazmayı geciktirir (arka arkaya gelen değişikliklerde tek yazma). */
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(write, 60);
}

/** Bekleyen yazmayı hemen diske indirir. Sekme arka plana atılırken/kapanırken şart:
 *  mobil tarayıcılar sekmeyi haber vermeden öldürebilir. */
export function flush() {
  if (saveTimer !== null) { clearTimeout(saveTimer); write(); }
}

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export const db = () => state;
export const settings = () => state.settings;

export function setSetting(k, v) { state.settings[k] = v; save(); }

export function replaceAll(next) {
  state = {
    ...structuredClone(DEFAULTS), ...next,
    settings: { ...DEFAULTS.settings, ...(next.settings || {}) },
    audience: { ...structuredClone(DEFAULTS.audience), ...(next.audience || {}) },
    decision: { ...structuredClone(DEFAULTS.decision), ...(next.decision || {}) },
  };
  save();
}

export function wipe() {
  state = structuredClone(DEFAULTS);
  localStorage.removeItem(KEY);
  save();
}

/* ---------------- profiller (API bağlantıları) ---------------- */
export function addProfile(p) {
  const prof = { id: uid(), enabled: true, extraHeaders: {}, ...p };
  state.profiles.push(prof);
  if (!state.settings.activeProfile) state.settings.activeProfile = prof.id;
  save();
  return prof;
}
export function updateProfile(id, patch) {
  const p = state.profiles.find((x) => x.id === id);
  if (p) Object.assign(p, patch);
  save();
  return p;
}
export function removeProfile(id) {
  state.profiles = state.profiles.filter((x) => x.id !== id);
  if (state.settings.activeProfile === id) state.settings.activeProfile = state.profiles[0]?.id || '';
  save();
}
export function moveProfile(id, dir) {
  const i = state.profiles.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= state.profiles.length) return;
  [state.profiles[i], state.profiles[j]] = [state.profiles[j], state.profiles[i]];
  save();
}
export function activeProfile() {
  return state.profiles.find((p) => p.id === state.settings.activeProfile && p.enabled)
      || state.profiles.find((p) => p.enabled) || null;
}
/** Aktif profil önce, ardından diğer etkin profiller (yedek zinciri). */
export function profileChain() {
  const act = activeProfile();
  const rest = state.profiles.filter((p) => p.enabled && p !== act);
  return act ? [act, ...rest] : rest;
}

/* ---------------- görevler ---------------- */
export function addTask(t) {
  const task = {
    id: uid(), title: '', notes: '', due: null, priority: 'normal',
    status: 'open', createdAt: Date.now(), doneAt: null, ...t,
  };
  state.tasks.unshift(task);
  save();
  return task;
}
export function updateTask(id, patch) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return null;
  Object.assign(t, patch);
  if (patch.status === 'done' && !t.doneAt) t.doneAt = Date.now();
  if (patch.status === 'open') t.doneAt = null;
  save();
  return t;
}
export function removeTask(id) { state.tasks = state.tasks.filter((x) => x.id !== id); save(); }

/* ---------------- notlar ---------------- */
export function addNote(n) {
  const note = { id: uid(), title: '', body: '', updatedAt: Date.now(), ...n };
  state.notes.unshift(note);
  save();
  return note;
}
export function updateNote(id, patch) {
  const n = state.notes.find((x) => x.id === id);
  if (n) Object.assign(n, patch, { updatedAt: Date.now() });
  save();
  return n;
}
export function removeNote(id) { state.notes = state.notes.filter((x) => x.id !== id); save(); }

/* ---------------- hafıza ---------------- */
export function remember(k, v) { state.memory[k] = v; save(); }
export function forget(k) { delete state.memory[k]; save(); }

/* ---------------- hatırlatıcılar ---------------- */
export function addReminder(r) {
  const rem = { id: uid(), fired: false, ...r };
  state.reminders.push(rem);
  save();
  return rem;
}
export function updateReminder(id, patch) {
  const r = state.reminders.find((x) => x.id === id);
  if (r) Object.assign(r, patch);
  save();
  return r;
}
export function removeReminder(id) { state.reminders = state.reminders.filter((x) => x.id !== id); save(); }

/* ---------------- sohbet ---------------- */
export function pushChat(m) {
  state.chat.push({ ts: Date.now(), ...m });
  if (state.chat.length > 300) state.chat = state.chat.slice(-300);
  save();
}
export function clearChat() { state.chat = []; save(); }

/* ---- kitle tahmini ---- */
export function saveInstitution(id, profile) { state.audience.institutions[id] = { ...profile, id }; save(); return state.audience.institutions[id]; }
export function removeInstitution(id) { delete state.audience.institutions[id]; delete state.audience.calibration[id]; save(); }
export function setCalibration(key, cal) { state.audience.calibration[key] = cal; save(); }

/* ---- karar tahmini ---- */
const dec = () => (state.decision ||= structuredClone(DEFAULTS.decision));
export function saveScenario(id, spec) { dec().scenarios[id] = { ...spec, id }; save(); return dec().scenarios[id]; }
export function removeScenario(id) { const d = dec(); delete d.scenarios[id]; delete d.datasets[id]; delete d.models[id]; save(); }
export function saveDataset(id, ds) { dec().datasets[id] = { ...ds, rows: ds.rows.slice(0, 5000), at: Date.now() }; save(); }
export function saveModel(id, model) { dec().models[id] = { ...model, at: Date.now() }; save(); }
