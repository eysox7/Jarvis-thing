// Influence — ekranlar ve kablolama.
import { S, save, wipe, storageBytes } from './store.js';
import { $, esc, hash, pct, toast, download, sleep } from './util.js';
import { DILEMMAS, BY_ID, isHoldout } from './dilemmas.js';
import { build, personaLines, answeredCount, MIN_ANSWERS, customDilemma } from './clone.js';
import { NOTICE, ITEMS, record, has, CONSENT_VERSION } from './consent.js';
import { readFile, toDoc } from './ingest.js';
import { decide, syncTest } from './decide.js';
import * as llm from './llm.js';
import { avatar, radar, ring, modal, closeModal } from './ui.js';
import { cardLink, exportFile, shareCard } from './share.js';
import * as arena from './arena.js';

const app = $('#app');
let current = 'home';
let params = {};

// ---------- yönlendirme ----------
export function go(view, p = {}) {
  if (view === 'home') view = homeView();
  current = view; params = p;
  render();
  window.scrollTo(0, 0);
}
export function render() {
  const fn = views[current] || views.lab;
  app.innerHTML = fn(params);
  app.dataset.view = current;
  const onboarding = ['welcome', 'consent', 'profile'].includes(current);
  $('#tabbar').hidden = onboarding;
  document.body.classList.toggle('with-tabs', !onboarding);
  for (const b of $('#tabbar').querySelectorAll('button')) b.classList.toggle('on', b.dataset.go === tabOf(current));
  $('#topRight').textContent = S.profile ? S.profile.code : '';
  afterRender[current]?.();
}
const tabOf = (v) => ({ train: 'feed', battle: 'arena' }[v] || v);

function homeView() {
  if (!S.consent) return 'welcome';
  if (!S.profile) return 'profile';
  if (answeredCount(S.answers) < MIN_ANSWERS && !S.clone) return 'train';
  return 'lab';
}

// ---------- yardımcılar ----------
const answered = () => answeredCount(S.answers);
const needsRebuild = () => {
  if (!S.clone) return true;
  const trainIds = Object.keys(S.answers).filter((id) => BY_ID[id] && !isHoldout(id));
  return trainIds.length !== Object.keys(S.clone.train).length || trainIds.some((id) => S.clone.train[id] !== S.answers[id].c)
    || Object.keys(S.answers).filter(isHoldout).length !== Object.keys(S.clone.test).length;
};
const docsStyle = () => S.docs.map((d) => d.style).filter(Boolean).join('; ').slice(0, 200);
const engineName = (e) => ({ core: 'Çekirdek', neural: 'Nöral', hybrid: 'Hibrit' }[e] || e);
const byName = (by) => ({ core: 'çekirdek', memory: 'hafıza', neural: 'nöral', 'hybrid-core': 'hibrit·çekirdek', 'hybrid-neural': 'hibrit·nöral', 'core-fallback': 'çekirdek (LLM yedeği)' }[by] || by);
export const helpers = { engineName, byName, ensureLLM };

// ---------- ekranlar ----------
const views = {
  welcome: () => `
    <section class="hero">
      <div class="holo">${avatar({ id: 'x', hue: 190 }, 120, 'float')}${avatar({ id: 'y', hue: 350 }, 120, 'float delay')}</div>
      <h1>Klonun, senin yerine<br><span class="grad">aynı kararı verir mi?</span></h1>
      <p class="dim">Verilerini yükle, yapay zeka klonunu telefonunda eğit, senkron oranını ölç.
      Sonra klonunu arkadaşlarının klonlarıyla Arena'da kapıştır.</p>
      <ol class="steps">
        <li><b>Rıza</b> — ne işlendiğini oku, onayla</li>
        <li><b>Besle</b> — 40 ikilemlik karar testi + istersen mesajların</li>
        <li><b>Senkron</b> — klon, görmediği 10 soruda seni tahmin etsin</li>
        <li><b>Arena</b> — klon düellosu, “kim seni daha iyi tanıyor?”</li>
      </ol>
      <button class="btn big primary" data-go="consent" id="startBtn">Klonumu oluştur</button>
      <p class="tiny dim">Her şey cihazında kalır. Sunucu yok.</p>
    </section>`,

  consent: () => `
    <section>
      <h2>Aydınlatma ve Açık Rıza</h2>
      <div class="notice">${NOTICE}</div>
      <form id="consentForm" class="checks">
        ${ITEMS.map((it) => `<label class="check"><input type="checkbox" name="${it.key}" ${S.consent?.items?.[it.key] ? 'checked' : ''} ${it.required ? 'data-req' : ''}><span>${it.text}</span></label>`).join('')}
      </form>
      <p class="tiny dim">Sürüm ${CONSENT_VERSION}. Rızanı istediğin an Ayarlar'dan geri çekebilirsin; o anda tüm verilerin silinir.</p>
      <button class="btn big primary" data-act="acceptConsent" id="consentBtn">Onaylıyorum</button>
    </section>`,

  profile: () => {
    const p = S.profile || { name: '', bio: '', hue: hash(String(Date.now())) % 360 };
    return `
    <section>
      <h2>Klon kimliği</h2>
      <div class="center" id="avaPrev">${avatar({ id: p.name || 'new', hue: p.hue }, 110, 'float')}</div>
      <label class="field">Takma ad<input id="pName" maxlength="24" value="${esc(p.name)}" placeholder="ör. Deniz" autocomplete="nickname"></label>
      <label class="field">Hologram rengi<input id="pHue" type="range" min="0" max="359" value="${p.hue}"></label>
      <label class="field">Kendini 2-3 cümlede anlat <span class="dim">(isteğe bağlı, nöral klonu besler)</span>
        <textarea id="pBio" maxlength="280" rows="3" placeholder="ör. Plan yapmayı severim ama arkadaşlarım için her planı bozarım.">${esc(p.bio)}</textarea></label>
      <button class="btn big primary" data-act="saveProfile" id="profileBtn">Devam</button>
    </section>`;
  },

  train: () => {
    const next = DILEMMAS.find((d) => !S.answers[d.id]);
    const n = answered();
    const bar = `<div class="progress"><i style="width:${(n / DILEMMAS.length) * 100}%"></i></div>
      <div class="row between tiny dim"><span>Karar testi</span><span id="trainCount">${n}/${DILEMMAS.length}</span></div>`;
    if (!next) return `<section>${bar}<div class="card center"><h2>Tamamlandı ✓</h2><p class="dim">40 kararın kaydedildi. 10'u klondan gizli tutulacak.</p>
      <button class="btn big primary" data-act="buildClone">Klonu oluştur</button></div></section>`;
    return `
    <section>${bar}
      <div class="card dilemma" data-id="${next.id}">
        <div class="tiny dim mono">${next.id.toUpperCase()}${isHoldout(next.id) ? ' · <span class="tag">sınav sorusu</span>' : ''}</div>
        <h2 class="q">${esc(next.q)}</h2>
        <button class="opt" data-act="answer" data-c="A" id="optA"><span class="key">A</span>${esc(next.a.t)}</button>
        <button class="opt" data-act="answer" data-c="B" id="optB"><span class="key">B</span>${esc(next.b.t)}</button>
        <p class="tiny dim">İçinden ilk geleni seç. Doğru cevap yok.</p>
      </div>
      <div class="row between">
        <button class="btn ghost" data-act="undo" ${n ? '' : 'disabled'}>↶ Geri al</button>
        ${n >= MIN_ANSWERS ? `<button class="btn" data-act="buildClone" id="buildEarly">Şimdilik yeter, klonu kur →</button>` : `<span class="tiny dim">En az ${MIN_ANSWERS} karar gerekli</span>`}
      </div>
    </section>`;
  },

  feed: () => {
    const n = answered();
    const docs = S.docs.map((d) => `<li class="doc"><div><b>${esc(d.name)}</b><div class="tiny dim">${d.kind} · ${d.chunks.length} parça · ${Math.round(d.chars / 1000)} bin karakter${d.style ? ' · tarz: ' + esc(d.style) : ''}</div></div>
      <button class="btn ghost small" data-act="delDoc" data-id="${d.id}" aria-label="Sil">🗑</button></li>`).join('');
    return `
    <section>
      <h2>Klonunu besle</h2>
      <div class="card">
        <div class="row between"><b>Karar testi</b><span class="mono">${n}/${DILEMMAS.length}</span></div>
        <div class="progress"><i style="width:${(n / DILEMMAS.length) * 100}%"></i></div>
        <p class="tiny dim">Klonun asıl öğretmeni. Her 4 sorudan biri sınav için gizli tutulur.</p>
        <div class="row">
          <button class="btn primary" data-go="train" ${n >= DILEMMAS.length ? 'disabled' : ''}>${n ? 'Devam et' : 'Başla'}</button>
          <button class="btn ghost" data-act="resetAnswers" ${n ? '' : 'disabled'}>Baştan çöz</button>
        </div>
      </div>
      <div class="card">
        <b>Mesajlar ve metinler</b>
        <p class="tiny dim">WhatsApp dışa aktarımı (.txt), notlar, günlük, JSON/CSV. Yalnızca <b>senin</b> mesajların tutulur, dosya cihazdan çıkmaz.
        Nöral klon karar verirken buradan alıntı yapar ve yazım tarzını taklit eder.</p>
        ${has('files') ? `
          <label class="btn" for="fileIn">📎 Dosya seç</label>
          <input id="fileIn" type="file" accept=".txt,.md,.json,.csv,text/plain,application/json" multiple hidden>
          <textarea id="pasteIn" rows="3" placeholder="…ya da buraya yapıştır (kendinle ilgili notlar, paylaşımların)"></textarea>
          <button class="btn ghost" data-act="addPaste">Metni ekle</button>
          <ul class="docs">${docs || '<li class="tiny dim">Henüz veri yok.</li>'}</ul>`
        : `<p class="warn">Dosya işleme için rıza vermedin.</p><button class="btn" data-go="consent">Rızamı güncelle</button>`}
      </div>
    </section>`;
  },

  lab: () => {
    const c = S.clone;
    const n = answered();
    if (!c) return `<section><div class="card center"><h2>Henüz klonun yok</h2><p class="dim">${n}/${MIN_ANSWERS} karar verdin.</p>
      ${n >= MIN_ANSWERS ? '<button class="btn big primary" data-act="buildClone">Klonu oluştur</button>' : '<button class="btn big primary" data-go="train">Karar testine devam</button>'}</div></section>`;
    const stale = needsRebuild();
    const last = c.sync?.[params.show || 'core'] || c.sync?.core;
    const traits = personaLines(c);
    return `
    <section>
      <div class="idcard">
        ${avatar(c, 84, 'float')}
        <div><h2>${esc(c.name)}</h2><div class="mono dim">${esc(c.code)} · v${c.gen}</div>
        <div class="tiny dim">${Object.keys(c.train).length} eğitim · ${Object.keys(c.test).length} sınav sorusu</div></div>
      </div>
      ${stale ? `<div class="card warnbox"><b>Yeni verin var.</b> Klonu güncelle ki öğrensin. <button class="btn small primary" data-act="buildClone">Güncelle</button></div>` : ''}
      <div class="rings">
        <div>${ring(c.sync?.core?.acc, 'ÇEKİRDEK')}</div>
        <div>${ring(c.sync?.neural?.acc, 'NÖRAL')}</div>
      </div>
      <p class="tiny dim center">Yazı-tura atsa %50 tutturur. Klonun bunun ne kadar üstünde?</p>
      <div class="row center">
        <button class="btn" data-act="runSync" data-engine="core" id="syncCore">⚡ Çekirdek testi</button>
        <button class="btn" data-act="runSync" data-engine="neural" id="syncNeural">🧠 Nöral test</button>
      </div>
      ${last?.rows ? syncTable(last) : ''}
      <h3>Kişilik DNA'sı</h3>
      <div class="card center">${radar([c])}<p class="dna-text">${traits.length ? esc(traits.join(' · ')) : 'Henüz belirgin bir eğilim yok — daha çok karar ver.'}</p></div>
      <h3>Klonuna sor</h3>
      <div class="card">
        <input id="askQ" placeholder="İkilem: ör. Konsere mi gideyim, sınava mı çalışayım?">
        <div class="row"><input id="askA" placeholder="A seçeneği"><input id="askB" placeholder="B seçeneği"></div>
        <button class="btn primary" data-act="askClone" id="askBtn">Klonum ne der?</button>
        <div id="askOut"></div>
      </div>
      <h3>Klon kartı</h3>
      <div class="card">
        <p class="tiny dim">Kart; takma adını, DNA'nı, test seçimlerini ve kısa tanıtımını içerir. Mesajların ve dosyaların <b>girmez</b>.</p>
        ${has('share') ? `<div class="row">
          <button class="btn primary" data-act="share" id="shareBtn">📤 Paylaş</button>
          <button class="btn ghost" data-act="exportCard">⬇ Dosya</button>
          <button class="btn ghost" data-act="copyLink" id="copyLinkBtn">🔗 Bağlantı</button></div>`
        : `<p class="warn">Paylaşım için rıza vermedin.</p><button class="btn" data-go="consent">Rızamı güncelle</button>`}
      </div>
    </section>`;
  },

  arena: () => arena.view(),
  battle: () => arena.battleView(),

  settings: () => {
    const s = S.settings;
    const gpu = llm.webgpu();
    const mem = navigator.deviceMemory ? `${navigator.deviceMemory} GB+ RAM` : 'RAM bilinmiyor';
    return `
    <section>
      <h2>Ayarlar</h2>
      <h3>Klon motoru</h3>
      <div class="card">
        ${['core', 'neural', 'hybrid'].map((e) => `<label class="radio"><input type="radio" name="engine" value="${e}" ${s.engine === e ? 'checked' : ''} data-act="setEngine">
          <span><b>${engineName(e)}</b> <span class="tiny dim">${{ core: 'istatistiksel model · anında, her telefonda', neural: 'yerel dil modeli · gerekçeli, Türkçe konuşur', hybrid: 'çekirdek eminse o, değilse LLM karar verir' }[e]}</span></span></label>`).join('')}
      </div>
      <h3>Yerel yapay zeka</h3>
      <div class="card">
        <div class="tiny">WebGPU: <b class="${gpu ? 'ok' : 'bad'}">${gpu ? 'var ✓' : 'yok ✗'}</b> · ${mem}</div>
        <label class="radio"><input type="radio" name="backend" value="webllm" ${s.backend === 'webllm' ? 'checked' : ''} data-act="setBackend"><span><b>Telefonda</b> <span class="tiny dim">model indirilir, internetsiz çalışır</span></span></label>
        <label class="radio"><input type="radio" name="backend" value="server" ${s.backend === 'server' ? 'checked' : ''} data-act="setBackend"><span><b>Ağdaki bilgisayarım</b> <span class="tiny dim">Ollama / LM Studio</span></span></label>
        ${s.backend === 'webllm' ? `
          <label class="field">Model<select id="modelSel" data-act="setModel">${llm.MODELS.map((m) => `<option value="${m.id}" ${s.model === m.id ? 'selected' : ''}>${m.label} — ${m.size} (${m.note})</option>`).join('')}</select></label>
          <button class="btn primary" data-act="loadModel" id="loadModelBtn" ${gpu ? '' : 'disabled'}>${llm.ready() ? '✓ Model hazır' : '⬇ İndir ve yükle'}</button>
          <div id="llmProg" class="tiny dim">${esc(llm.state.text || '')}</div>
          <p class="tiny dim">İlk indirme bir kez yapılır (Wi-Fi önerilir), sonra önbellekten açılır. Verilerin modele cihazda verilir; hiçbir yere gönderilmez.</p>`
        : `
          <label class="field">Uç nokta<input id="srvUrl" value="${esc(s.serverUrl)}" placeholder="http://192.168.1.20:11434/v1"></label>
          <label class="field">Model adı<input id="srvModel" value="${esc(s.serverModel)}"></label>
          <button class="btn" data-act="saveServer">Kaydet ve dene</button>
          <p class="tiny dim">Uygulama https üzerinden açıksa tarayıcı http yerel adresleri engelleyebilir; bu durumda uygulamayı da yerelden aç.</p>`}
      </div>
      <h3>Profil</h3>
      <div class="card"><div class="row between"><span>${esc(S.profile?.name || '')} <span class="mono dim">${esc(S.profile?.code || '')}</span></span><button class="btn ghost small" data-go="profile">Düzenle</button></div></div>
      <h3>Rıza ve verilerim</h3>
      <div class="card">
        <div class="tiny">Rıza sürümü <b>${esc(S.consent?.version || '—')}</b> · ${S.consent ? new Date(S.consent.at).toLocaleString('tr-TR') : ''}</div>
        <ul class="tiny">${ITEMS.map((i) => `<li>${S.consent?.items?.[i.key] ? '✓' : '✗'} ${i.key === 'process' ? 'Klon oluşturma' : i.key === 'adult' ? '18+ beyanı' : i.key === 'files' ? 'Dosya işleme' : 'Kart paylaşımı'}</li>`).join('')}</ul>
        <div class="tiny dim">Cihazda kullanılan alan: ${(storageBytes() / 1024).toFixed(0)} KB</div>
        <div class="row wrap">
          <button class="btn ghost" data-go="consent">Rızayı güncelle</button>
          <button class="btn ghost" data-act="exportAll">Verilerimi indir</button>
          <button class="btn danger" data-act="wipe" id="wipeBtn">Rızamı geri çek ve her şeyi sil</button>
        </div>
      </div>
    </section>`;
  },
};

function syncTable(t) {
  return `<details class="card"><summary class="row between"><b>${engineName(t.engine)} sınavı</b><span class="mono">${t.rows.filter((r) => r.hit).length}/${t.n} · detay</span></summary>
    <table class="sync"><thead><tr><th>Soru</th><th>Sen</th><th>Klon</th><th></th></tr></thead><tbody>
    ${t.rows.map((r) => { const d = BY_ID[r.id]; return `<tr class="${r.hit ? 'hit' : 'miss'}"><td>${esc(d.q)}<div class="tiny dim">${esc(r.reason || '')}</div></td><td>${r.truth}</td><td>${r.choice}<div class="tiny dim">${pct(r.conf)}</div></td><td>${r.hit ? '✓' : '✗'}</td></tr>`; }).join('')}
    </tbody></table></details>`;
}

const afterRender = {
  profile() {
    const upd = () => { $('#avaPrev').innerHTML = avatar({ id: $('#pName').value || 'new', hue: +$('#pHue').value }, 110, 'float'); };
    $('#pHue').addEventListener('input', upd);
    $('#pName').addEventListener('input', upd);
  },
  train() { trainShownAt = performance.now(); },
  feed() {
    const fi = $('#fileIn');
    if (fi) fi.addEventListener('change', () => handleFiles([...fi.files]));
  },
  arena: () => arena.afterRender?.(),
  battle: () => arena.afterBattle?.(),
};
let trainShownAt = 0;

// ---------- eylemler ----------
const actions = {
  closeModal,
  async acceptConsent() {
    const items = {};
    for (const it of ITEMS) items[it.key] = !!$(`#consentForm [name="${it.key}"]`).checked;
    const missing = ITEMS.filter((i) => i.required && !items[i.key]);
    if (missing.length) return toast('Zorunlu onayları işaretlemelisin.', 'err');
    // Rıza daraltıldıysa ilgili veriyi hemen sil.
    if (!items.files && S.docs.length) { S.docs = []; if (S.clone) S.clone.style = ''; }
    await record(items);
    toast('Rıza kaydedildi.');
    go('home');
    arena.flushPending();
  },
  saveProfile() {
    const name = $('#pName').value.trim();
    if (!name) return toast('Bir takma ad yaz.', 'err');
    const hue = +$('#pHue').value;
    const code = S.profile?.code || 'IN-' + String(hash(name + Date.now()) % 10000).padStart(4, '0');
    S.profile = { name, hue, code, bio: $('#pBio').value.trim() };
    if (S.clone) Object.assign(S.clone, { name, hue, bio: S.profile.bio });
    save();
    go(S.clone ? 'settings' : 'train');
  },
  answer(el) {
    const id = el.closest('.dilemma').dataset.id;
    S.answers[id] = { c: el.dataset.c, ms: Math.round(performance.now() - trainShownAt), at: Date.now() };
    save();
    el.classList.add('picked');
    setTimeout(() => {
      if (answered() >= DILEMMAS.length) return actions.buildClone();
      render();
    }, 160);
  },
  undo() {
    const last = Object.entries(S.answers).sort((a, b) => b[1].at - a[1].at)[0];
    if (last) { delete S.answers[last[0]]; save(); render(); }
  },
  resetAnswers() {
    if (!confirm('Tüm karar testi cevapların silinsin mi? Klonun da sıfırlanır.')) return;
    S.answers = {}; S.clone = null; save(); go('train');
  },
  async buildClone() {
    if (answered() < MIN_ANSWERS) return toast(`En az ${MIN_ANSWERS} karar gerekli.`, 'err');
    modal(`<div class="center"><div class="helix"></div><h3>DNA dizileniyor…</h3><p class="tiny dim">Kararlarından ağırlıklar öğreniliyor.</p></div>`);
    await sleep(700);
    S.clone = build(S.answers, S.profile, S.clone);
    S.clone.style = docsStyle();
    S.clone.sync.core = await syncTest(S.clone, 'core');
    save();
    closeModal();
    toast(`Klon v${S.clone.gen} hazır · senkron ${pct(S.clone.sync.core.acc)}`);
    go('lab', { show: 'core' });
  },
  async runSync(el) {
    const engine = el.dataset.engine;
    if (engine !== 'core' && !(await ensureLLM())) return;
    modal(`<div class="center"><div class="helix"></div><h3>${engineName(engine)} sınav</h3><p id="syncProg" class="mono">0/${Object.keys(S.clone.test).length}</p></div>`);
    const res = await syncTest(S.clone, engine, (i, n) => { const p = $('#syncProg'); if (p) p.textContent = `${i}/${n}`; });
    S.clone.sync[engine === 'core' ? 'core' : 'neural'] = res;
    save();
    closeModal();
    go('lab', { show: engine === 'core' ? 'core' : 'neural' });
  },
  async askClone() {
    const q = $('#askQ').value.trim(), a = $('#askA').value.trim(), b = $('#askB').value.trim();
    if (!q || !a || !b) return toast('İkilemi ve iki seçeneği yaz.', 'err');
    $('#askOut').innerHTML = '<p class="dim">Klon düşünüyor…</p>';
    const d = customDilemma(q, a, b);
    const r = await decide(S.clone, d);
    $('#askOut').innerHTML = `<div class="answer"><div class="big-choice">${r.choice}) ${esc(r.choice === 'A' ? a : b)}</div>
      <p>“${esc(r.reason)}”</p><div class="tiny dim">${byName(r.by)} · güven ${pct(r.conf)}</div></div>`;
  },
  async share() {
    const r = await shareCard(S.clone);
    if (r === 'copied') toast('Bağlantı panoya kopyalandı.');
    else if (r !== 'shared' && r !== 'aborted') modal(`<h3>Bağlantı</h3><textarea rows="5" readonly>${esc(r)}</textarea>`);
  },
  exportCard() { exportFile(S.clone); },
  async copyLink() {
    const url = cardLink(S.clone);
    try { await navigator.clipboard.writeText(url); toast('Bağlantı kopyalandı.'); }
    catch { modal(`<h3>Bağlantı</h3><textarea rows="5" readonly id="linkOut">${esc(url)}</textarea>`); }
  },
  async addPaste() {
    const t = $('#pasteIn').value.trim();
    if (t.length < 20) return toast('Biraz daha uzun bir metin yapıştır.', 'err');
    S.docs.push(toDoc({ kind: 'not', name: 'Not ' + new Date().toLocaleDateString('tr-TR'), text: t }));
    save(); toast('Eklendi.'); render();
  },
  delDoc(el) {
    S.docs = S.docs.filter((d) => d.id !== el.dataset.id);
    if (S.clone) S.clone.style = docsStyle();
    save(); render();
  },
  setEngine(el) { S.settings.engine = el.value; save(); },
  setBackend(el) { S.settings.backend = el.value; save(); render(); },
  setModel(el) { S.settings.model = el.value; save(); render(); },
  async loadModel() { await ensureLLM(); render(); },
  async saveServer() {
    S.settings.serverUrl = $('#srvUrl').value.trim();
    S.settings.serverModel = $('#srvModel').value.trim();
    save();
    try { await llm.complete([{ role: 'user', content: 'Sadece "tamam" yaz.' }], { max_tokens: 5 }); toast('Yerel sunucu yanıt verdi ✓'); }
    catch (e) { toast('Bağlanamadı: ' + e.message, 'err'); }
  },
  exportAll() { download(`influence-verilerim-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(S, null, 2)); },
  wipe() {
    if (!confirm('Rızanı geri çekiyorsun. Klonun, cevapların, dosyaların ve arkadaş kartların bu cihazdan kalıcı olarak silinecek. Emin misin?')) return;
    wipe();
    toast('Tüm verilerin silindi.');
    go('home');
  },
};

export async function ensureLLM() {
  if (llm.ready()) return true;
  if (S.settings.backend === 'webllm' && !llm.webgpu()) {
    toast('Bu tarayıcıda WebGPU yok — çekirdek motor kullanılacak.', 'err');
    return false;
  }
  const m = llm.MODELS.find((x) => x.id === S.settings.model);
  modal(`<div class="center"><div class="helix"></div><h3>Yerel model yükleniyor</h3><p class="tiny dim">${esc(m?.label || S.settings.model)} · ${esc(m?.size || '')}</p>
    <div class="progress"><i id="mProg" style="width:0%"></i></div><p id="mText" class="tiny dim mono"></p></div>`);
  try {
    await llm.load((p, text) => { const b = $('#mProg'); if (b) b.style.width = Math.round(p * 100) + '%'; const t = $('#mText'); if (t) t.textContent = text; });
    closeModal();
    toast('Yerel model hazır 🧠');
    return true;
  } catch (e) {
    $('#modalBody').innerHTML = `<h3>Model yüklenemedi</h3><p class="warn">${esc(e.message)}</p><p class="tiny dim">Daha hafif bir model seç ya da çekirdek motorla devam et.</p>`;
    return false;
  }
}

async function handleFiles(files) {
  for (const f of files) {
    if (f.size > 20 * 1024 * 1024) { toast(`${f.name} çok büyük (20 MB sınırı).`, 'err'); continue; }
    const parsed = await readFile(f);
    if (parsed.kind === 'whatsapp') {
      const who = await pickSender(parsed);
      if (!who) continue;
      S.docs.push(toDoc(parsed, who));
    } else S.docs.push(toDoc(parsed));
  }
  if (S.clone) S.clone.style = docsStyle();
  save();
  render();
}

function pickSender(parsed) {
  return new Promise((resolve) => {
    modal(`<h3>Bu sohbette hangisi sensin?</h3><p class="tiny dim">Yalnızca seçtiğin kişinin mesajları saklanır; diğerleri hemen atılır.</p>
      ${parsed.senders.slice(0, 8).map((s) => `<button class="btn block" data-who="${esc(s.who)}">${esc(s.who)} <span class="dim">· ${s.n} mesaj</span></button>`).join('')}`);
    const body = $('#modalBody');
    const onClick = (e) => {
      const b = e.target.closest('[data-who]');
      if (!b) return;
      body.removeEventListener('click', onClick);
      closeModal();
      resolve(b.dataset.who);
    };
    body.addEventListener('click', onClick);
    $('#modal .x').addEventListener('click', () => resolve(null), { once: true });
  });
}

// ---------- olay delegasyonu ----------
document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-go]');
  if (g && !g.disabled) { e.preventDefault(); return go(g.dataset.go); }
  const a = e.target.closest('[data-act]');
  if (!a || a.disabled || a.tagName === 'SELECT' || (a.tagName === 'INPUT' && a.type === 'radio')) return;
  const fn = actions[a.dataset.act] || arena.actions[a.dataset.act];
  if (fn) { e.preventDefault(); fn(a); }
});
document.addEventListener('change', (e) => {
  const a = e.target.closest('[data-act]');
  if (!a || !(a.tagName === 'SELECT' || a.type === 'radio')) return;
  const fn = actions[a.dataset.act] || arena.actions[a.dataset.act];
  if (fn) fn(a);
});
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

// ---------- açılış ----------
arena.init({ go, render, helpers });
const incoming = location.hash.match(/#klon=([A-Za-z0-9_-]+)/);
history.replaceState(null, '', location.pathname + location.search);
go('home');
if (incoming) arena.receiveLink(incoming[0]);

if ('serviceWorker' in navigator && !navigator.webdriver) navigator.serviceWorker.register('sw.js').catch(() => {});
