// Uygulama kablolaması: sekmeler, sohbet döngüsü, görev/not/bağlantı/ayar ekranları.
import { $, $$, el, fmtDate, uid } from './util.js';
import * as S from './store.js';
import * as UI from './ui.js';
import * as Speech from './speech.js';
import { PRESETS, listModels, testProfile, kindOf } from './providers.js';
import { runAgent } from './agent.js';
import { runMatrixWithChain } from './tools.js';
import { Voice } from './voice.js';

const VERSION = '1.1.0';
let busy = false;
let abortCtrl = null;

/* ============================ sekmeler ============================ */
function showView(name) {
  $$('#views .view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  $$('#tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'tasks') renderTasks();
  if (name === 'notes') renderNotes();
  if (name === 'matrix') renderMatrix();
  if (name === 'conn') renderConnections();
  if (name === 'settings') renderSettings();
}
$('#tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) showView(b.dataset.view);
});

/* ============================ durum ============================ */
function setStatus(kind, label) {
  const dot = $('#statusDot');
  dot.className = 'dot ' + kind;
  if (label !== undefined) $('#composerHint').textContent = label;
}
function refreshHeader() {
  const p = S.activeProfile();
  $('#activeProfileLabel').textContent = p ? `${p.name} · ${p.model || 'model yok'}` : 'bağlantı yok';
  setStatus(p ? 'ok' : 'err');
}

/* ============================ eller serbest ses ============================ */
const voiceBar = $('#voiceBar');

const voice = new Voice({
  getSettings: () => S.settings(),
  onState: (state, label) => {
    const on = state !== 'off';
    voiceBar.hidden = !on;
    voiceBar.className = 'voice-bar ' + (on ? state : '');
    $('#voiceState').textContent = label;
    if (state !== 'command' && state !== 'asking') $('#voiceHeard').textContent = '';
    $('#btnHands').classList.toggle('on', on);
    $('#btnMic').style.display = on || !Speech.sttSupported ? 'none' : '';
  },
  onPartial: (t) => { $('#voiceHeard').textContent = t; },
  onCommand: (t) => { $('#voiceHeard').textContent = ''; send(t); },
  onLocal: (id) => handleVoiceCommand(id),
  onError: (e, soft) => {
    UI.toast(e.message, 'err');
    if (!soft) UI.addMessage('sys', '🎧 ' + e.message);
  },
});

function handleVoiceCommand(id) {
  switch (id) {
    case 'stop':
      Speech.stopSpeaking();
      abortCtrl?.abort();
      voice._backToIdle();
      break;
    case 'sleep':
      // Sesle kapatmak da kalıcı olsun; yoksa uygulama bir sonraki açılışta
      // kullanıcı istemediği hâlde yeniden dinlemeye başlar.
      voice.stop();
      S.setSetting('handsFree', false);
      break;
    case 'repeat':
      voice.repeatLast();
      break;
    case 'newchat':
      S.clearChat();
      restoreChat();
      voice.say('Yeni sohbet başlattım.');
      break;
    case 'help':
      UI.addMessage('sys', '🎧 ' + voice.helpText());
      voice.say(voice.helpText());
      break;
  }
}

/** Sesli modda onay/soru pencerelerini sesle cevaplanabilir hâle getirir. */
function voiceHook(question, opts = {}) {
  if (!voice.active) return undefined;
  return {
    start: (done) => {
      voice.captureAnswer(question, opts).then((ans) => {
        if (ans === null) return;                 // ses karar veremedi, ekran açık kalsın
        done(opts.yesNo ? ans === 'evet' : ans);
      });
    },
    cancel: () => voice.cancelCapture(),
  };
}

$('#btnHands').addEventListener('click', async () => {
  if (voice.active) { voice.stop(); S.setSetting('handsFree', false); return; }
  const started = await voice.start();
  if (started) {
    S.setSetting('handsFree', true);
    UI.addMessage('sys', '🎧 Eller serbest açık. ' + voice.helpText());
  }
});

/* ============================ bildirim & hatırlatıcı ============================ */
async function notify(title, body) {
  try {
    if ('Notification' in window) {
      if (Notification.permission === 'default') await Notification.requestPermission();
      if (Notification.permission === 'granted') {
        const reg = await navigator.serviceWorker?.getRegistration();
        if (reg?.showNotification) await reg.showNotification(title, { body, icon: 'icons/icon.svg', tag: uid() });
        else new Notification(title, { body, icon: 'icons/icon.svg' });
        return true;
      }
    }
  } catch { /* geri düş */ }
  UI.toast(`${title}${body ? ' — ' + body : ''}`);
  return false;
}

let reminderTimer = null;
function scheduleReminders() {
  clearInterval(reminderTimer);
  reminderTimer = setInterval(checkReminders, 20000);
  checkReminders();
}
function checkReminders() {
  const now = Date.now();
  for (const r of S.db().reminders) {
    if (r.fired || r.at > now) continue;
    S.updateReminder(r.id, { fired: true });
    notify('⏰ Hatırlatma', r.message);
    UI.addMessage('sys', `⏰ ${r.message}`);
    if (voice.active) voice.say('Hatırlatma: ' + r.message);
    else if (S.settings().tts) Speech.speak(r.message, { lang: S.settings().lang });
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  }
}

/* ============================ sohbet ============================ */
function restoreChat() {
  UI.clearChatLog();
  const chat = S.db().chat;
  if (!chat.length) {
    UI.addMessage('sys',
      S.db().profiles.length
        ? 'Hazırım. Ne yapmamı istersin?'
        : 'Başlamak için “API” sekmesinden bir bağlantı ekle (Gemini ve Groq ücretsiz katman sunuyor).');
    return;
  }
  for (const m of chat.slice(-60)) {
    if (m.role === 'user') UI.addMessage('user', m.content);
    else if (m.role === 'assistant') UI.addMessage('bot', m.content, { html: true });
    else UI.addMessage('sys', m.content);
  }
  UI.scrollChat(true);
}

async function send(text) {
  text = (text ?? $('#input').value).trim();
  if (!text || busy) return;

  if (!S.db().profiles.filter((p) => p.enabled).length) {
    UI.toast('Önce bir API bağlantısı ekle', 'err');
    if (voice.active) voice.say('Önce bir API bağlantısı eklemelisin. Ekrandaki API sekmesinden ekleyebilirsin.');
    showView('conn');
    return;
  }

  $('#input').value = '';
  autoGrow();
  UI.addMessage('user', text);
  S.pushChat({ role: 'user', content: text });

  busy = true;
  abortCtrl = new AbortController();
  $('#btnStop').hidden = false;
  setStatus('busy', 'düşünüyor…');
  const typing = UI.addTyping();

  let firstReply = true;
  let lastReply = '';
  let liveBubble = null;
  const dropLive = () => { liveBubble?.remove(); liveBubble = null; };
  if (voice.active) voice.agentStart();

  try {
    const res = await runAgent(text, {
      signal: abortCtrl.signal,
      onStatus: (s) => setStatus('busy', s),
      onStream: (partial) => {
        typing.remove();
        if (!liveBubble) liveBubble = UI.addMessage('bot', '');
        liveBubble.textContent = partial;
        UI.scrollChat();
      },
      onStreamEnd: dropLive,
      onPlan: (plan, steps) => { typing.remove(); dropLive(); UI.addPlanCard(plan, steps); },
      onReply: (t) => {
        typing.remove();
        dropLive();
        UI.addMessage('bot', t, { html: true });
        S.pushChat({ role: 'assistant', content: t });
        lastReply = t;
        // Eller serbest moddayken okuma işini ses denetleyicisi üstlenir
        // (mikrofonu duraklatması gerekiyor), burada okursak üst üste biner.
        if (!voice.active && firstReply && S.settings().tts) {
          Speech.speak(t, { lang: S.settings().lang, rate: S.settings().voiceRate });
          firstReply = false;
        }
      },
      onToolStart: (name, args) => { typing.remove(); dropLive(); return UI.addToolCard(name, args); },
      onToolEnd: (handle, out) => UI.finishToolCard(handle, out),
      onProfileUsed: (p) => {
        if (p.id !== S.settings().activeProfile) {
          $('#activeProfileLabel').textContent = `${p.name} · ${p.model} (yedek)`;
        }
      },
      onRefresh: () => { renderTasks(); renderNotes(); renderMatrix(); },
      confirm: (m) => UI.confirmDialog(m, { danger: true, external: voiceHook(m, { yesNo: true }) }),
      ask: (q, o) => UI.askDialog(q, o, voiceHook(q, { options: o || [] })),
      notify,
      speak: (t) => (voice.active ? voice.say(t) : Speech.speak(t, { lang: S.settings().lang })),
      scheduleReminders,
    });
    if (res?.aborted) { UI.addMessage('sys', 'Durduruldu.'); lastReply = ''; }
  } catch (e) {
    console.error(e);
    typing.remove();
    dropLive();
    const msg = e?.message || 'Bilinmeyen hata';
    UI.addMessage('err', '⚠ ' + msg);
    S.pushChat({ role: 'system', content: '⚠ ' + msg });
    lastReply = 'Bir sorun çıktı. ' + msg;
  } finally {
    typing.remove();
    dropLive();
    busy = false;
    abortCtrl = null;
    $('#btnStop').hidden = true;
    refreshHeader();
    setStatus(S.activeProfile() ? 'ok' : 'err', '');
    renderTasks();
    UI.scrollChat();
    // Cevabı oku, sonra tekrar dinlemeye dön. Beklemiyoruz: kullanıcı
    // okuma sırasında yazmaya devam edebilsin.
    if (voice.active) voice.agentEnd(lastReply);
  }
}

function autoGrow() {
  const t = $('#input');
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 140) + 'px';
}

$('#input').addEventListener('input', autoGrow);
$('#input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !/Android|iPhone|iPad/i.test(navigator.userAgent)) {
    e.preventDefault();
    send();
  }
});
$('#btnSend').addEventListener('click', () => send());
$('#btnStop').addEventListener('click', () => { abortCtrl?.abort(); Speech.stopSpeaking(); voice._backToIdle(); });
$('#btnNewChat').addEventListener('click', async () => {
  if (S.db().chat.length && !(await UI.confirmDialog('Sohbet geçmişi silinsin mi? Görevler ve notlar kalır.', { okText: 'Sil', danger: true }))) return;
  S.clearChat();
  restoreChat();
});

/* ---- bas-konuş mikrofonu (eller serbest kapalıyken) ---- */
$('#btnMic').addEventListener('click', () => {
  const btn = $('#btnMic');
  if (Speech.isListening()) { Speech.stopListen(); btn.classList.remove('rec'); return; }
  const started = Speech.listenOnce({
    lang: S.settings().lang || 'tr-TR',
    onPartial: (t) => { $('#input').value = t; autoGrow(); },
    onFinal: (t) => { $('#input').value = t; autoGrow(); setTimeout(() => send(), 250); },
    onEnd: () => btn.classList.remove('rec'),
    onError: (e) => { btn.classList.remove('rec'); UI.toast(e.message, 'err'); },
  });
  btn.classList.toggle('rec', started);
});
if (!Speech.sttSupported) { $('#btnMic').style.display = 'none'; $('#btnHands').style.display = 'none'; }

/* ============================ görevler ============================ */
let taskFilter = 'open';
$('#taskFilter').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  taskFilter = b.dataset.f;
  $$('#taskFilter button').forEach((x) => x.classList.toggle('active', x === b));
  renderTasks();
});
$('#btnTaskAdd').addEventListener('click', () => {
  const v = $('#taskTitle').value.trim();
  if (!v) return;
  S.addTask({ title: v });
  $('#taskTitle').value = '';
  renderTasks();
});
$('#taskTitle').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnTaskAdd').click(); });

function renderTasks() {
  const host = $('#taskList');
  if (!host) return;
  let list = S.db().tasks;
  if (taskFilter !== 'all') list = list.filter((t) => t.status === taskFilter);
  host.innerHTML = '';
  if (!list.length) { host.append(el('div', { class: 'empty', text: 'Görev yok.' })); return; }

  for (const t of list) {
    const overdue = t.due && t.status === 'open' && t.due < Date.now();
    host.append(el('div', { class: 'item' + (t.status === 'done' ? ' done' : '') },
      el('div', { class: 'top' },
        el('div', {
          class: 'chk' + (t.status === 'done' ? ' on' : ''),
          onclick: () => { S.updateTask(t.id, { status: t.status === 'done' ? 'open' : 'done' }); renderTasks(); },
        }),
        el('div', { class: 'title' },
          el('div', { text: t.title }),
          t.notes ? el('div', { class: 'muted small', style: 'margin-top:3px;white-space:pre-wrap', text: t.notes }) : null,
          el('div', { class: 'meta' },
            t.due ? el('span', { style: overdue ? 'color:#ff9d9d' : '', text: '⏱ ' + fmtDate(t.due) }) : null,
            t.priority !== 'normal' ? el('span', { class: t.priority === 'high' ? 'pri-high' : 'pri-low', text: t.priority === 'high' ? '‼ yüksek' : '↓ düşük' }) : null,
            el('span', { text: 'eklendi ' + fmtDate(t.createdAt) }),
          ),
        ),
        el('button', {
          class: 'btn tiny',
          onclick: () => UI.promptDialog('Görevi düzenle', [
            { key: 'title', label: 'Başlık', value: t.title },
            { key: 'notes', label: 'Not', type: 'textarea', value: t.notes || '' },
            { key: 'due', label: 'Son tarih (ör. "yarın 15:00")', value: t.due ? new Date(t.due).toISOString().slice(0, 16) : '' },
            { key: 'priority', label: 'Öncelik (low/normal/high)', value: t.priority },
          ], (v) => {
            S.updateTask(t.id, {
              title: v.title.trim() || t.title,
              notes: v.notes,
              due: v.due ? (Date.parse(v.due) || null) : null,
              priority: ['low', 'normal', 'high'].includes(v.priority) ? v.priority : 'normal',
            });
            renderTasks();
          }),
        }, '✎'),
        el('button', {
          class: 'btn tiny',
          onclick: async () => {
            if (await UI.confirmDialog(`"${t.title}" silinsin mi?`, { okText: 'Sil', danger: true })) { S.removeTask(t.id); renderTasks(); }
          },
        }, '🗑'),
      ),
    ));
  }
}

/* ============================ notlar ============================ */
$('#btnNoteAdd').addEventListener('click', () => {
  UI.promptDialog('Yeni not', [
    { key: 'title', label: 'Başlık', value: '' },
    { key: 'body', label: 'İçerik', type: 'textarea', rows: 8, value: '' },
  ], (v) => {
    if (!v.title.trim() && !v.body.trim()) return false;
    S.addNote({ title: v.title.trim() || 'Not', body: v.body });
    renderNotes();
  });
});
$('#noteSearch').addEventListener('input', renderNotes);

function renderNotes() {
  const host = $('#noteList');
  if (!host) return;
  const q = $('#noteSearch').value.trim().toLocaleLowerCase('tr');
  const list = S.db().notes.filter((n) => !q || (n.title + ' ' + n.body).toLocaleLowerCase('tr').includes(q));
  host.innerHTML = '';
  if (!list.length) { host.append(el('div', { class: 'empty', text: 'Not yok.' })); return; }

  for (const n of list) {
    host.append(el('div', { class: 'item' },
      el('div', { class: 'top' },
        el('div', { class: 'title' },
          el('strong', { text: n.title }),
          el('div', { class: 'muted small', style: 'margin-top:4px;white-space:pre-wrap', text: n.body.slice(0, 320) }),
          el('div', { class: 'meta' }, el('span', { text: fmtDate(n.updatedAt) })),
        ),
        el('button', {
          class: 'btn tiny',
          onclick: () => UI.promptDialog('Notu düzenle', [
            { key: 'title', label: 'Başlık', value: n.title },
            { key: 'body', label: 'İçerik', type: 'textarea', rows: 10, value: n.body },
          ], (v) => { S.updateNote(n.id, { title: v.title, body: v.body }); renderNotes(); }),
        }, '✎'),
        el('button', {
          class: 'btn tiny',
          onclick: async () => {
            if (await UI.confirmDialog(`"${n.title}" silinsin mi?`, { okText: 'Sil', danger: true })) { S.removeNote(n.id); renderNotes(); }
          },
        }, '🗑'),
      ),
    ));
  }
}

/* ============================ matrAIx ============================ */
let mxBusy = false;
let mxOpen = null;   // açık koşunun id'si; varsayılan en yenisi

$('#btnMxRun').addEventListener('click', async () => {
  if (mxBusy) { abortCtrl?.abort(); return; }
  const brief = {
    product: $('#mxProduct').value.trim(),
    regions: $('#mxRegions').value,
    audience: $('#mxAudience').value.trim(),
    goal: $('#mxGoal').value.trim(),
    count: Number($('#mxCount').value) || 15,
    keywordLang: $('#mxKwLang').value.trim() || 'en',
  };
  if (!brief.product) { UI.toast('Ürünü yaz', 'err'); $('#mxProduct').focus(); return; }
  if (!S.db().profiles.filter((p) => p.enabled).length) { UI.toast('Önce bir API bağlantısı ekle', 'err'); showView('conn'); return; }
  if (busy) { UI.toast('Sohbette bir iş sürüyor, bitmesini bekle', 'err'); return; }

  mxBusy = true;
  abortCtrl = new AbortController();
  $('#btnMxRun').textContent = '■ Durdur';
  setStatus('busy');
  const t0 = Date.now();
  try {
    const run = await runMatrixWithChain(brief, {
      signal: abortCtrl.signal,
      onStage: (_st, info) => { $('#mxStatus').textContent = `matrAIx: ${info.label}…`; },
    });
    mxOpen = run.id;
    $('#mxStatus').textContent = `✔ ${run.combos.length} kombinasyon · ${run.calls} model çağrısı · ${((Date.now() - t0) / 1000).toFixed(1)} sn`;
  } catch (e) {
    $('#mxStatus').textContent = e.name === 'AbortError' ? 'Durduruldu.' : '⚠ ' + (e.message || e);
  } finally {
    mxBusy = false;
    abortCtrl = null;
    $('#btnMxRun').textContent = '▶ PR koşusunu başlat';
    setStatus(S.activeProfile() ? 'ok' : 'err');
    renderMatrix();
  }
});

function renderMatrix() {
  const host = $('#mxRuns');
  if (!host) return;
  const runs = S.db().matrix || [];
  host.innerHTML = '';
  if (!runs.length) { host.append(el('div', { class: 'empty', text: 'Henüz koşu yok.' })); return; }
  const openId = mxOpen ?? runs[0].id;

  for (const r of runs) {
    const a = r.analysis || {};
    const body = el('div', { class: 'body' + (r.id === openId ? '' : ' hidden') },
      a.summary ? el('div', { class: 'small', text: a.summary }) : null,
      a.motivations?.length ? el('div', { class: 'mx-sec', text: 'Satın alma güdüleri' }) : null,
      a.motivations?.length ? el('div', { class: 'small', text: a.motivations.join(' · ') }) : null,
      a.barriers?.length ? el('div', { class: 'mx-sec', text: 'Engeller' }) : null,
      a.barriers?.length ? el('div', { class: 'small', text: a.barriers.join(' · ') }) : null,
      el('div', { class: 'mx-sec', text: 'Sıralı anahtar kelimeler' }),
      ...r.combos.map((c) => el('div', { class: 'mx-combo' },
        el('span', { class: 'rk', text: c.rank }),
        el('div', { class: 'kw' },
          el('strong', { text: c.keyword }),
          el('div', { class: 'meta muted small', text: [c.intent, c.trigger, c.placement].filter(Boolean).join(' · ') }),
          c.note ? el('div', { class: 'muted small', text: c.note }) : null,
        ),
        el('span', {
          class: 'mx-score' + (c.score >= 75 ? ' hi' : c.score >= 55 ? ' mid' : ''),
          title: c.scores ? `niyet ${c.scores.intent} · güdü ${c.scores.trigger} · uyum ${c.scores.relevance} · rekabet ${c.scores.competition}` : '',
          text: c.score ?? '-',
        }),
      )),
      el('p', { class: 'muted small', text: 'Puanlar modelin niteliksel tahminidir, arama hacmi değildir.' }),
      el('div', { class: 'row gap wrap' },
        el('button', {
          class: 'btn tiny',
          onclick: async () => {
            try { await navigator.clipboard.writeText(r.report); UI.toast('Rapor (markdown) kopyalandı'); }
            catch { UI.toast('Kopyalanamadı', 'err'); }
          },
        }, '⧉ Raporu kopyala'),
        el('button', {
          class: 'btn tiny',
          onclick: () => { S.addNote({ title: `matrAIx — ${r.brief.product}`, body: r.report }); UI.toast('Notlara kaydedildi'); },
        }, '📝 Nota kaydet'),
        el('button', {
          class: 'btn tiny',
          onclick: async () => {
            if (await UI.confirmDialog('Bu koşu silinsin mi?', { okText: 'Sil', danger: true })) {
              S.removeMatrixRun(r.id); if (mxOpen === r.id) mxOpen = null; renderMatrix();
            }
          },
        }, '🗑'),
      ),
    );
    host.append(el('div', { class: 'item mx-run', 'data-run': r.id },
      el('div', {
        class: 'head',
        onclick: () => { mxOpen = body.classList.contains('hidden') ? r.id : ''; renderMatrix(); },
      },
        el('div', { class: 't' },
          el('strong', { text: r.brief.product }),
          el('div', { class: 'meta' },
            el('span', { text: `${r.combos.length} kombinasyon` }),
            r.brief.regions?.length ? el('span', { text: r.brief.regions.join(', ') }) : null,
            el('span', { text: fmtDate(r.createdAt) }),
          ),
        ),
        el('span', { class: 'muted small', text: r.id === openId ? '▾' : '▸' }),
      ),
      body,
    ));
  }
}

/* ============================ bağlantılar (API) ============================ */
$('#btnConnAdd').addEventListener('click', () => connectionEditor(null));

function connectionEditor(existing) {
  UI.openModal({
    title: existing ? 'Bağlantıyı düzenle' : 'Yeni bağlantı',
    render: (close) => {
      const wrap = el('div', {});

      const provSel = el('select', {},
        ...Object.entries(PRESETS).map(([k, v]) => el('option', { value: k }, v.label)));
      const nameIn = el('input', { placeholder: 'Bağlantı adı' });
      const baseIn = el('input', { placeholder: 'https://…', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
      const keyIn = el('input', { type: 'password', placeholder: 'API anahtarı', autocomplete: 'off' });
      const modelIn = el('input', { placeholder: 'model adı', autocapitalize: 'off', spellcheck: 'false' });
      const modelSel = el('select', {}, el('option', { value: '' }, '— hazır modeller —'));
      const keyHint = el('div', { class: 'muted small' });

      const applyPreset = (k, keepValues = false) => {
        const p = PRESETS[k];
        if (!keepValues) {
          baseIn.value = p.baseUrl;
          modelIn.value = p.models[0] || '';
          if (!nameIn.value || Object.values(PRESETS).some((x) => x.label === nameIn.value)) nameIn.value = p.label;
        }
        modelSel.innerHTML = '';
        modelSel.append(el('option', { value: '' }, '— hazır modeller —'));
        for (const m of p.models) modelSel.append(el('option', { value: m }, m));
        keyIn.parentElement.style.display = p.noKey ? 'none' : '';
        keyHint.innerHTML = p.keyUrl
          ? `Anahtar al: <a href="${p.keyUrl}" target="_blank" rel="noopener">${new URL(p.keyUrl).host}</a>`
          : (p.noKey ? 'Bu sağlayıcı yerel çalışır, anahtar gerekmez.' : '');
      };

      provSel.addEventListener('change', () => applyPreset(provSel.value));
      modelSel.addEventListener('change', () => { if (modelSel.value) modelIn.value = modelSel.value; });

      wrap.append(
        el('label', {}, 'Sağlayıcı', provSel),
        el('label', {}, 'Ad', nameIn),
        el('label', {}, 'API anahtarı', keyIn),
        keyHint,
        el('label', {}, 'Sunucu adresi (base URL)', baseIn),
        el('label', {}, 'Model', modelIn),
        el('label', {}, 'Hazır / çekilen modeller', modelSel),
      );

      const status = el('div', { class: 'muted small', style: 'margin-top:8px;white-space:pre-wrap' });
      const collect = () => ({
        provider: provSel.value,
        kind: PRESETS[provSel.value].kind,
        name: nameIn.value.trim() || PRESETS[provSel.value].label,
        baseUrl: baseIn.value.trim() || PRESETS[provSel.value].baseUrl,
        apiKey: keyIn.value.trim(),
        model: modelIn.value.trim(),
      });

      wrap.append(el('div', { class: 'row gap wrap', style: 'margin-top:10px' },
        el('button', {
          class: 'btn tiny',
          onclick: async (e) => {
            const b = e.currentTarget; b.disabled = true; status.textContent = 'modeller alınıyor…';
            try {
              const ids = await listModels(collect(), S.settings().proxy);
              modelSel.innerHTML = '';
              modelSel.append(el('option', { value: '' }, `— ${ids.length} model —`));
              for (const m of ids) modelSel.append(el('option', { value: m }, m));
              status.textContent = `${ids.length} model bulundu.`;
            } catch (err) { status.textContent = '✖ ' + err.message; }
            b.disabled = false;
          },
        }, '↻ Modelleri çek'),
        el('button', {
          class: 'btn tiny',
          onclick: async (e) => {
            const b = e.currentTarget; b.disabled = true; status.textContent = 'test ediliyor…';
            try {
              const r = await testProfile(collect(), S.settings().proxy);
              status.textContent = `✔ çalışıyor (${r.ms} ms) — "${r.text}"`;
            } catch (err) { status.textContent = '✖ ' + err.message; }
            b.disabled = false;
          },
        }, '⚡ Bağlantıyı test et'),
      ), status);

      wrap.append(el('div', { class: 'actions' },
        el('button', { class: 'btn', onclick: () => close() }, 'Vazgeç'),
        el('button', {
          class: 'btn primary',
          onclick: () => {
            const p = collect();
            if (!p.model) { status.textContent = '✖ model adı gerekli'; return; }
            if (!p.baseUrl) { status.textContent = '✖ sunucu adresi gerekli'; return; }
            if (existing) S.updateProfile(existing.id, p);
            else S.setSetting('activeProfile', S.addProfile(p).id);
            close(); renderConnections(); refreshHeader();
            UI.toast('Bağlantı kaydedildi');
          },
        }, 'Kaydet'),
      ));

      // Başlangıç değerleri
      provSel.value = existing?.provider || 'gemini';
      applyPreset(provSel.value);
      if (existing) {
        nameIn.value = existing.name || '';
        baseIn.value = existing.baseUrl || '';
        keyIn.value = existing.apiKey || '';
        modelIn.value = existing.model || '';
      }
      return wrap;
    },
  });
}

function renderConnections() {
  const host = $('#connList');
  if (!host) return;
  host.innerHTML = '';
  const profiles = S.db().profiles;
  if (!profiles.length) {
    host.append(el('div', { class: 'empty', text: 'Henüz bağlantı yok. Gemini veya Groq ücretsiz anahtar veriyor — oradan başlayabilirsin.' }));
    return;
  }
  profiles.forEach((p, i) => {
    const isActive = S.settings().activeProfile === p.id;
    host.append(el('div', { class: 'item' },
      el('div', { class: 'top' },
        el('div', { class: 'title' },
          el('div', {},
            el('strong', { text: p.name }),
            isActive ? el('span', { class: 'badge ok', style: 'margin-left:8px', text: 'aktif' }) : null,
            !p.enabled ? el('span', { class: 'badge', style: 'margin-left:8px', text: 'kapalı' }) : null,
          ),
          el('div', { class: 'meta' },
            el('span', { text: PRESETS[p.provider]?.label || p.provider }),
            el('span', { text: p.model || 'model yok' }),
            el('span', { text: kindOf(p) }),
            el('span', { text: p.apiKey ? '🔑 anahtar var' : '🔓 anahtarsız' }),
          ),
        ),
      ),
      el('div', { class: 'row gap wrap', style: 'margin-top:9px' },
        !isActive ? el('button', { class: 'btn tiny', onclick: () => { S.setSetting('activeProfile', p.id); renderConnections(); refreshHeader(); } }, 'Aktif yap') : null,
        el('button', { class: 'btn tiny', onclick: () => connectionEditor(p) }, '✎ Düzenle'),
        el('button', { class: 'btn tiny', onclick: () => { S.updateProfile(p.id, { enabled: !p.enabled }); renderConnections(); refreshHeader(); } }, p.enabled ? 'Kapat' : 'Aç'),
        i > 0 ? el('button', { class: 'btn tiny', onclick: () => { S.moveProfile(p.id, -1); renderConnections(); } }, '▲') : null,
        i < profiles.length - 1 ? el('button', { class: 'btn tiny', onclick: () => { S.moveProfile(p.id, 1); renderConnections(); } }, '▼') : null,
        el('button', {
          class: 'btn tiny danger',
          onclick: async () => {
            if (await UI.confirmDialog(`"${p.name}" silinsin mi?`, { okText: 'Sil', danger: true })) { S.removeProfile(p.id); renderConnections(); refreshHeader(); }
          },
        }, '🗑'),
      ),
    ));
  });
}

/* ============================ ayarlar ============================ */
const SETTING_FIELDS = [
  ['setUserName', 'userName', 'value'],
  ['setPersona', 'persona', 'value'],
  ['setMaxSteps', 'maxSteps', 'number'],
  ['setTemp', 'temperature', 'number'],
  ['setAutoApprove', 'autoApprove', 'checked'],
  ['setStream', 'stream', 'checked'],
  ['setTTS', 'tts', 'checked'],
  ['setHandsFree', 'handsFree', 'checked'],
  ['setRequireWake', 'requireWake', 'checked'],
  ['setWakeWord', 'wakeWord', 'value'],
  ['setBargeIn', 'bargeIn', 'checked'],
  ['setVoiceRate', 'voiceRate', 'number'],
  ['setLang', 'lang', 'value'],
  ['setProxy', 'proxy', 'value'],
  ['setSearchProvider', 'searchProvider', 'value'],
  ['setSearchKey', 'searchKey', 'value'],
];

function renderSettings() {
  const st = S.settings();
  for (const [id, key, type] of SETTING_FIELDS) {
    const node = $('#' + id);
    if (!node) continue;
    if (type === 'checked') node.checked = !!st[key];
    else node.value = st[key] ?? '';
  }
  $('#verLabel').textContent = VERSION;
  const bytes = new Blob([localStorage.getItem('nexus.v1') || '']).size;
  $('#storageInfo').textContent =
    `Yerel veri: ${(bytes / 1024).toFixed(1)} KB · ${S.db().tasks.length} görev · ${S.db().notes.length} not · ${S.db().profiles.length} bağlantı`;
}

for (const [id, key, type] of SETTING_FIELDS) {
  const node = $('#' + id);
  if (!node) continue;
  node.addEventListener('change', () => {
    const v = type === 'checked' ? node.checked : type === 'number' ? Number(node.value) : node.value;
    S.setSetting(key, v);
    if (key === 'tts' && !v) Speech.stopSpeaking();
    renderSettings();
  });
}

$('#btnExport').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(S.db(), null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `nexus-yedek-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a); a.click(); a.remove();
  UI.toast('Yedek indirildi (API anahtarların da içinde — dikkatli sakla)');
});

$('#btnImport').addEventListener('click', () => {
  const inp = el('input', { type: 'file', accept: 'application/json', style: 'display:none' });
  inp.addEventListener('change', async () => {
    const f = inp.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data || typeof data !== 'object') throw new Error('geçersiz dosya');
      if (!(await UI.confirmDialog('Mevcut veriler bu yedekle değiştirilecek. Devam?', { okText: 'Değiştir', danger: true }))) return;
      S.replaceAll(data);
      UI.toast('Yedek yüklendi');
      restoreChat(); renderTasks(); renderNotes(); renderMatrix(); renderConnections(); renderSettings(); refreshHeader();
    } catch (e) { UI.toast('İçe aktarma başarısız: ' + e.message, 'err'); }
  });
  document.body.append(inp); inp.click(); setTimeout(() => inp.remove(), 1000);
});

$('#btnWipe').addEventListener('click', async () => {
  if (!(await UI.confirmDialog('TÜM veriler silinecek: bağlantılar, görevler, notlar, hafıza, sohbet. Geri alınamaz.', { okText: 'Hepsini sil', danger: true }))) return;
  S.wipe();
  restoreChat(); renderTasks(); renderNotes(); renderMatrix(); renderConnections(); renderSettings(); refreshHeader();
  UI.toast('Her şey silindi');
});

/* ============================ açılış ============================ */
function boot() {
  restoreChat();
  refreshHeader();
  renderSettings();
  scheduleReminders();
  autoGrow();

  S.onChange(() => refreshHeader());

  window.addEventListener('online', () => setStatus(S.activeProfile() ? 'ok' : 'err', ''));
  window.addEventListener('offline', () => setStatus('err', 'çevrimdışı'));

  // Sekme arka plana atılırken bekleyen yazmayı hemen tamamla.
  window.addEventListener('pagehide', () => S.flush());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') S.flush(); });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('sw kaydı başarısız', e));
  }

  // Bekleyen hatırlatma varsa bildirim iznini önden iste.
  if (S.db().reminders.some((r) => !r.fired) && 'Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }

  // Eller serbest kalıcı olarak açıksa geri yükle. Tarayıcılar mikrofonu ve sesi
  // ancak bir kullanıcı hareketinden sonra başlatır; ilk dokunuşu bekliyoruz.
  if (S.settings().handsFree && Speech.sttSupported) {
    $('#composerHint').textContent = '🎧 Eller serbest hazır — başlatmak için ekrana bir kez dokun';
    const resume = async () => {
      document.removeEventListener('pointerdown', resume);
      $('#composerHint').textContent = '';
      if (!voice.active) await voice.start();
    };
    document.addEventListener('pointerdown', resume, { once: true });
  }
}
boot();

// Hata ayıklama için konsoldan erişim.
window.NEXUS = { store: S, send, version: VERSION };
