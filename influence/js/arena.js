// Arena: klonlar kapışıyor. Üç mod:
//   knows → "Kim seni daha iyi tanıyor?" arkadaş tahmini vs klon tahmini
//   duel  → iki klon, sahiplerinin gizli sınav cevaplarını tahmin etmede yarışır
//   same  → iki klon aynı ikilemle yüzleşir, gerekçeleriyle; uyum ölçülür
import { S, save } from './store.js';
import { $, esc, pct, shuffle, toast, uid } from './util.js';
import { BY_ID, DILEMMAS } from './dilemmas.js';
import { compat, customDilemma } from './clone.js';
import { decide } from './decide.js';
import { avatar, radar, modal, closeModal, cloneChip } from './ui.js';
import { parseLinkOrJson, addFriend } from './share.js';

let ctx; // { go, render, helpers }
let B = null; // aktif savaş
export const init = (c) => { ctx = c; };

const all = () => [S.clone, ...S.friends].filter(Boolean);
const find = (id) => all().find((c) => c.id === id);
const opt = (d, c) => (c === 'A' ? d.a.t : d.b.t);
const select = (id, sel) => `<select id="${id}">${all().map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}${c.own ? ' (sen)' : ''}</option>`).join('')}</select>`;

// ---------- sıralama ----------
function leaderboard() {
  const rows = all().map((c) => {
    const duelWins = S.battles.filter((b) => b.mode === 'duel' && b.winner === c.id).length;
    const knowsWins = S.battles.filter((b) => b.mode === 'knows' && b.target === c.id && b.winner === 'clone').length;
    const sync = Math.max(c.sync?.core?.acc ?? 0, c.sync?.neural?.acc ?? 0) || null;
    return { c, duelWins, knowsWins, sync, etki: Math.round(100 * (sync ?? 0.5)) + 20 * duelWins + 10 * knowsWins };
  });
  return rows.sort((a, b) => b.etki - a.etki);
}

export function view() {
  const clones = all();
  const lb = leaderboard();
  const two = clones.length >= 2;
  const second = clones[1]?.id;
  return `
  <section>
    <h2>Klon Arenası</h2>
    <div class="card">
      <div class="row between"><b>Kadro</b><span class="tiny dim">${clones.length} klon</span></div>
      <div class="roster">${clones.map((c) => `<div class="roster-item">${cloneChip(c, ` · ${pct(c.sync?.core?.acc)}`)}
        ${c.own ? '' : `<button class="btn ghost small" data-act="removeFriend" data-id="${c.id}" aria-label="Çıkar">✕</button>`}</div>`).join('') || '<p class="dim">Önce kendi klonunu oluştur.</p>'}</div>
      <details ${two ? '' : 'open'}><summary>Arkadaşının klonunu ekle</summary>
        <p class="tiny dim">Arkadaşın Klonum → Paylaş ile bağlantı veya dosya göndersin.</p>
        <textarea id="importText" rows="2" placeholder="Bağlantıyı ya da kart JSON'unu yapıştır"></textarea>
        <div class="row"><button class="btn" data-act="importText" id="importBtn">Ekle</button>
        <label class="btn ghost" for="importFile">📎 Dosyadan</label><input id="importFile" type="file" accept=".json,application/json" hidden></div>
      </details>
    </div>

    <div class="mode card">
      <div class="mode-h"><span class="mode-ico">🎯</span><div><b>Kim Seni Daha İyi Tanıyor?</b><div class="tiny dim">Arkadaşın vs klonun. Gizli 10 sınav sorusunda kim daha çok tutturacak?</div></div></div>
      <label class="field">Kimin hakkında?${select('kTarget', S.clone?.id)}</label>
      <label class="field">Tahmin eden<input id="kGuesser" placeholder="Tahmin edenin adı"></label>
      <button class="btn primary" data-act="startKnows" id="startKnows" ${clones.length ? '' : 'disabled'}>Başlat</button>
    </div>

    <div class="mode card">
      <div class="mode-h"><span class="mode-ico">⚔️</span><div><b>Klon Düellosu</b><div class="tiny dim">İki klon, sahiplerinin gerçek cevaplarını tahmin ediyor. Sahibine en sadık klon kazanır.</div></div></div>
      <div class="row">${select('dA', S.clone?.id)}<span class="vs">VS</span>${select('dB', second)}</div>
      <button class="btn primary" data-act="startDuel" id="startDuel" ${two ? '' : 'disabled'}>Düelloyu başlat</button>
      ${two ? '' : '<p class="tiny dim">Düello için en az 2 klon gerekli.</p>'}
    </div>

    <div class="mode card">
      <div class="mode-h"><span class="mode-ico">🌀</span><div><b>Aynı İkilem</b><div class="tiny dim">İki klon aynı soruyla yüzleşir, kendi ağızlarından savunur. Uyumunuz kaç?</div></div></div>
      <div class="row">${select('sA', S.clone?.id)}<span class="vs">VS</span>${select('sB', second)}</div>
      <input id="sQ" placeholder="Kendi ikilemin (boş bırakırsan rastgele)">
      <div class="row"><input id="sOA" placeholder="A seçeneği"><input id="sOB" placeholder="B seçeneği"></div>
      <button class="btn primary" data-act="startSame" id="startSame" ${two ? '' : 'disabled'}>Yüzleştir</button>
    </div>

    <h3>Etki sıralaması</h3>
    <div class="card"><ol class="lb">${lb.map((r, i) => `<li><span class="rank">${i + 1}</span>${avatar(r.c, 34)}<span class="lb-name">${esc(r.c.name)}${r.c.own ? ' <span class="tag">sen</span>' : ''}</span>
      <span class="tiny dim">senk ${pct(r.sync)} · ${r.duelWins}🏆 · ${r.knowsWins}🎯</span><b class="etki">${r.etki}</b></li>`).join('')}</ol>
      <p class="tiny dim">Etki = senkron×100 + 20×düello zaferi + 10×arkadaşını yenme</p></div>

    ${S.battles.length ? `<h3>Son savaşlar</h3><div class="card"><ul class="hist">${S.battles.slice(-6).reverse().map(histLine).join('')}</ul></div>` : ''}
  </section>`;
}

function histLine(b) {
  const t = new Date(b.at).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  if (b.mode === 'knows') return `<li>🎯 ${esc(b.guesser)} ${b.friendScore} – ${b.cloneScore} ${esc(b.targetName)} klonu <span class="dim">· ${t}</span></li>`;
  if (b.mode === 'duel') return `<li>⚔️ ${esc(b.names[0])} ${b.score[0]} – ${b.score[1]} ${esc(b.names[1])} <span class="dim">· ${t}</span></li>`;
  return `<li>🌀 ${esc(b.names[0])} × ${esc(b.names[1])}: uyum ${pct(b.agree)} <span class="dim">· ${t}</span></li>`;
}

export function afterRender() {
  const f = $('#importFile');
  if (f) f.addEventListener('change', async () => { for (const file of f.files) tryImport(await file.text()); ctx.render(); });
}

function tryImport(text) {
  try {
    const c = parseLinkOrJson(text);
    const r = addFriend(c);
    toast(r === 'added' ? `${c.name} klonu kadroya katıldı ⚔️` : `${c.name} klonu güncellendi`);
    return true;
  } catch (e) { toast(e.message.startsWith('Unexpected') ? 'Kart okunamadı.' : e.message, 'err'); return false; }
}

export function importFlow() { if (tryImport($('#importText').value)) ctx.render(); }

export function receiveLink(hashPart) {
  if (!S.consent) { sessionStorage.setItem('influence.pending', hashPart); toast('Arkadaşının klonu bekliyor — önce kendi rızanı ver.'); return; }
  let c;
  try { c = parseLinkOrJson(hashPart); } catch (e) { return toast(e.message, 'err'); }
  modal(`<div class="center">${avatar(c, 90, 'float')}<h3>${esc(c.name)} klonu geldi</h3>
    <p class="tiny dim">${esc(c.code)} · senkron ${pct(c.sync?.core?.acc)}</p>
    <button class="btn primary" data-act="acceptIncoming" id="acceptIncoming">Arena'ya ekle</button></div>`);
  pendingIncoming = hashPart;
}
let pendingIncoming = null;
export function flushPending() {
  const p = sessionStorage.getItem('influence.pending');
  if (p) { sessionStorage.removeItem('influence.pending'); receiveLink(p); }
}

// ---------- savaş ekranı ----------
export function battleView() {
  if (!B) return view();
  if (B.mode === 'knows') return knowsView();
  if (B.mode === 'duel') return duelView();
  return sameView();
}

export async function afterBattle() {
  if (B?.mode === 'duel' && B.phase === 'think' && !B.busy) {
    B.busy = true;
    const r = B.rounds[B.i];
    const [p1, p2] = await Promise.all([decide(B.c1, r.d1, { useMemory: false }), decide(B.c2, r.d2, { useMemory: false })]);
    Object.assign(r, { p1, p2 });
    B.phase = 'pred'; B.busy = false;
    ctx.render();
  }
}

const header = (title) => `<div class="row between"><button class="btn ghost small" data-act="leaveBattle">← Arena</button><span class="mono dim">${title}</span></div>`;

function knowsView() {
  const t = B.target;
  if (!B.done) {
    const d = BY_ID[B.ids[B.i]];
    return `<section>${header(`${B.i + 1}/${B.ids.length}`)}
      <div class="versus small">${avatar({ id: B.guesser, hue: (t.hue + 140) % 360 }, 54)}<span class="vs">VS</span>${avatar(t, 54)}</div>
      <p class="center"><b>${esc(B.guesser)}</b>, sence <b>${esc(t.name)}</b> hangisini seçti?</p>
      <div class="card dilemma"><h2 class="q">${esc(d.q)}</h2>
        <button class="opt" data-act="knowsGuess" data-c="A" id="kA"><span class="key">A</span>${esc(d.a.t)}</button>
        <button class="opt" data-act="knowsGuess" data-c="B" id="kB"><span class="key">B</span>${esc(d.b.t)}</button></div>
      <p class="tiny dim center">Klon da aynı soruları gizlice tahmin ediyor. Ona bakmak yok.</p></section>`;
  }
  const win = B.result.winner;
  const verdict = win === 'clone' ? `🤖 Klon kazandı! ${esc(t.name)}'i klonu daha iyi tanıyor.` : win === 'friend' ? `🧑 ${esc(B.guesser)} kazandı! İnsanlık şimdilik önde.` : '🤝 Berabere — klonla aynı seviyedesin.';
  return `<section>${header('SONUÇ')}
    <div class="score"><div>${avatar({ id: B.guesser, hue: (t.hue + 140) % 360 }, 64)}<b>${esc(B.guesser)}</b><span class="num">${B.result.friend}</span></div>
      <span class="vs">VS</span><div>${avatar(t, 64)}<b>${esc(t.name)} klonu</b><span class="num">${B.result.clone}</span></div></div>
    <div class="verdict ${win}">${verdict}</div>
    <div class="card"><table class="sync"><thead><tr><th>Soru</th><th>Gerçek</th><th>${esc(B.guesser)}</th><th>Klon</th></tr></thead><tbody>
    ${B.ids.map((id) => { const d = BY_ID[id], truth = t.test[id], g = B.guesses[id], c = B.preds[id]; return `<tr><td>${esc(d.q)}<div class="tiny dim">${esc(opt(d, truth))}</div></td><td>${truth}</td><td class="${g === truth ? 'hitc' : 'missc'}">${g}</td><td class="${c.choice === truth ? 'hitc' : 'missc'}">${c.choice}</td></tr>`; }).join('')}
    </tbody></table></div>
    <div class="row center"><button class="btn primary" data-act="rematch">Rövanş</button><button class="btn ghost" data-act="leaveBattle">Arena</button></div></section>`;
}

function duelView() {
  const { c1, c2 } = B;
  if (B.phase === 'end') {
    const w = B.winner ? (B.winner === c1.id ? c1 : c2) : null;
    return `<section>${header('SONUÇ')}
      <div class="score"><div>${avatar(c1, 72, w === c1 ? 'crown' : '')}<b>${esc(c1.name)}</b><span class="num">${B.score[0]}</span></div><span class="vs">VS</span>
        <div>${avatar(c2, 72, w === c2 ? 'crown' : '')}<b>${esc(c2.name)}</b><span class="num">${B.score[1]}</span></div></div>
      <div class="verdict ${w ? 'clone' : 'tie'}">${w ? `🏆 ${esc(w.name)} klonu sahibine daha sadık!` : '🤝 Berabere!'}</div>
      ${B.tiebreak ? '<p class="tiny dim center">Eşitlik, doğru tahminlerdeki güvenle bozuldu.</p>' : ''}
      <div class="row center"><button class="btn primary" data-act="rematch">Rövanş</button><button class="btn ghost" data-act="leaveBattle">Arena</button></div></section>`;
  }
  const r = B.rounds[B.i];
  const same = r.d1.id === r.d2.id;
  const side = (c, d, p, truth, k) => `<div class="side">
    ${avatar(c, 60, B.phase === 'think' ? 'pulse' : '')}<b>${esc(c.name)}</b>
    ${same ? '' : `<div class="tiny dim">${esc(d.q)}</div>`}
    ${B.phase === 'think' ? '<div class="thinking">düşünüyor…</div>' : `
      <div class="pred">${p.choice}) ${esc(opt(d, p.choice))}</div><div class="tiny dim">“${esc(p.reason)}”</div>
      ${B.phase === 'reveal' ? `<div class="truth ${p.choice === truth ? 'hit' : 'miss'}">${esc(B[k].name)} gerçekte: ${truth} ${p.choice === truth ? '✓' : '✗'}</div>` : ''}`}
  </div>`;
  return `<section>${header(`RAUND ${B.i + 1}/${B.rounds.length}`)}
    <div class="scoreline"><span>${esc(c1.name)} <b>${B.score[0]}</b></span><span><b>${B.score[1]}</b> ${esc(c2.name)}</span></div>
    ${same ? `<div class="card"><h2 class="q">${esc(r.d1.q)}</h2><div class="tiny dim">A) ${esc(r.d1.a.t)} · B) ${esc(r.d1.b.t)}</div></div>` : ''}
    <div class="duel">${side(c1, r.d1, r.p1, c1.test[r.d1.id], 'c1')}<span class="vs">VS</span>${side(c2, r.d2, r.p2, c2.test[r.d2.id], 'c2')}</div>
    <div class="center">${B.phase === 'pred' ? '<button class="btn primary big" data-act="duelReveal" id="duelReveal">Gerçeği göster</button>'
      : B.phase === 'reveal' ? `<button class="btn primary big" data-act="duelNext" id="duelNext">${B.i + 1 < B.rounds.length ? 'Sonraki raund →' : 'Sonuç'}</button>` : ''}</div></section>`;
}

function sameView() {
  const { c1, c2, d, r1, r2, cp } = B;
  const agree = r1.choice === r2.choice;
  const side = (c, r) => `<div class="side">${avatar(c, 60)}<b>${esc(c.name)}</b><div class="pred">${r.choice}) ${esc(opt(d, r.choice))}</div>
    <div class="quote">“${esc(r.reason)}”</div><div class="tiny dim">${ctx.helpers.byName(r.by)} · güven ${pct(r.conf)}</div></div>`;
  return `<section>${header('AYNI İKİLEM')}
    <div class="card"><h2 class="q">${esc(d.q)}</h2><div class="tiny dim">A) ${esc(d.a.t)} · B) ${esc(d.b.t)}</div></div>
    <div class="duel">${side(c1, r1)}<span class="vs">VS</span>${side(c2, r2)}</div>
    <div class="verdict ${agree ? 'tie' : 'friend'}">${agree ? '🤝 Aynı fikirdesiniz' : '⚡ Ayrı düştünüz!'}</div>
    <div class="card center"><div class="row center"><div><div class="num">${pct(cp.agree)}</div><div class="tiny dim">karar uyumu (40 soru)</div></div>
      <div><div class="num">${pct(cp.dnaSim)}</div><div class="tiny dim">DNA benzerliği</div></div></div>${radar([c1, c2])}</div>
    <div class="row center"><button class="btn primary" data-act="sameAgain" id="sameAgain">Yeni rastgele ikilem</button><button class="btn ghost" data-act="leaveBattle">Arena</button></div></section>`;
}

function recordBattle(b) { S.battles.push({ id: uid(), at: new Date().toISOString(), ...b }); S.battles = S.battles.slice(-100); save(); }

// ---------- eylemler ----------
export const actions = {
  importText: () => importFlow(),
  acceptIncoming() { if (pendingIncoming && tryImport(pendingIncoming)) { pendingIncoming = null; closeModal(); ctx.go('arena'); } },
  removeFriend(el) {
    const f = S.friends.find((x) => x.id === el.dataset.id);
    if (!f || !confirm(`${f.name} klonu bu cihazdan silinsin mi?`)) return;
    S.friends = S.friends.filter((x) => x.id !== f.id); save(); ctx.render();
  },
  startKnows() {
    const target = find($('#kTarget').value);
    const guesser = $('#kGuesser').value.trim() || (target.own ? 'Arkadaş' : S.profile?.name || 'Ben');
    const ids = shuffle(Object.keys(target.test));
    if (ids.length < 3) return toast('Bu klonun sınav sorusu az — önce daha çok karar verilmeli.', 'err');
    B = { mode: 'knows', target, guesser, ids, i: 0, guesses: {}, preds: {}, done: false };
    ctx.go('battle');
  },
  async knowsGuess(el) {
    B.guesses[B.ids[B.i]] = el.dataset.c;
    B.i++;
    if (B.i < B.ids.length) return ctx.render();
    modal('<div class="center"><div class="helix"></div><h3>Klonun tahminleri açılıyor…</h3></div>');
    for (const id of B.ids) B.preds[id] = await decide(B.target, BY_ID[id], { useMemory: false });
    closeModal();
    const t = B.target.test;
    const friend = B.ids.filter((id) => B.guesses[id] === t[id]).length;
    const clone = B.ids.filter((id) => B.preds[id].choice === t[id]).length;
    const winner = clone > friend ? 'clone' : friend > clone ? 'friend' : 'tie';
    B.result = { friend, clone, winner };
    B.done = true;
    recordBattle({ mode: 'knows', target: B.target.id, targetName: B.target.name, guesser: B.guesser, friendScore: friend, cloneScore: clone, n: B.ids.length, winner });
    ctx.render();
  },
  startDuel() {
    const c1 = find($('#dA').value), c2 = find($('#dB').value);
    if (!c1 || !c2 || c1.id === c2.id) return toast('İki farklı klon seç.', 'err');
    const shared = shuffle(Object.keys(c1.test).filter((id) => c2.test[id]));
    let rounds;
    if (shared.length >= 3) rounds = shared.slice(0, 5).map((id) => ({ d1: BY_ID[id], d2: BY_ID[id] }));
    else {
      const a = shuffle(Object.keys(c1.test)), b = shuffle(Object.keys(c2.test));
      rounds = a.slice(0, Math.min(5, a.length, b.length)).map((id, i) => ({ d1: BY_ID[id], d2: BY_ID[b[i]] }));
    }
    if (!rounds.length) return toast('Klonların sınav sorusu yok.', 'err');
    B = { mode: 'duel', c1, c2, rounds, i: 0, phase: 'think', score: [0, 0], conf: [0, 0] };
    ctx.go('battle');
  },
  duelReveal() {
    const r = B.rounds[B.i];
    if (r.p1.choice === B.c1.test[r.d1.id]) { B.score[0]++; B.conf[0] += r.p1.conf; }
    if (r.p2.choice === B.c2.test[r.d2.id]) { B.score[1]++; B.conf[1] += r.p2.conf; }
    B.phase = 'reveal';
    ctx.render();
  },
  duelNext() {
    if (B.i + 1 < B.rounds.length) { B.i++; B.phase = 'think'; return ctx.render(); }
    let w = B.score[0] > B.score[1] ? 0 : B.score[1] > B.score[0] ? 1 : null;
    if (w === null && Math.abs(B.conf[0] - B.conf[1]) > 1e-6) { w = B.conf[0] > B.conf[1] ? 0 : 1; B.tiebreak = true; }
    B.winner = w === null ? null : [B.c1, B.c2][w].id;
    B.phase = 'end';
    recordBattle({ mode: 'duel', ids: [B.c1.id, B.c2.id], names: [B.c1.name, B.c2.name], score: B.score, winner: B.winner });
    ctx.render();
  },
  async startSame() {
    const c1 = find($('#sA').value), c2 = find($('#sB').value);
    if (!c1 || !c2 || c1.id === c2.id) return toast('İki farklı klon seç.', 'err');
    const q = $('#sQ').value.trim(), a = $('#sOA').value.trim(), b = $('#sOB').value.trim();
    const d = q && a && b ? customDilemma(q, a, b) : DILEMMAS[Math.floor(Math.random() * DILEMMAS.length)];
    await runSame(c1, c2, d);
  },
  async sameAgain() { await runSame(B.c1, B.c2, DILEMMAS[Math.floor(Math.random() * DILEMMAS.length)]); },
  rematch() {
    if (B.mode === 'knows') { B = { ...B, ids: shuffle(B.ids), i: 0, guesses: {}, preds: {}, done: false, result: null }; }
    else if (B.mode === 'duel') { B = { ...B, rounds: shuffle(B.rounds).map((r) => ({ d1: r.d1, d2: r.d2 })), i: 0, phase: 'think', score: [0, 0], conf: [0, 0], winner: null, tiebreak: false }; }
    ctx.go('battle');
  },
  leaveBattle() { B = null; ctx.go('arena'); },
};

async function runSame(c1, c2, d) {
  modal('<div class="center"><div class="helix"></div><h3>Klonlar düşünüyor…</h3></div>');
  // Yerel modelde iki istek aynı motoru paylaşır; sırayla çalıştır.
  const r1 = await decide(c1, d);
  const r2 = await decide(c2, d);
  closeModal();
  B = { mode: 'same', c1, c2, d, r1, r2, cp: compat(c1, c2) };
  recordBattle({ mode: 'same', ids: [c1.id, c2.id], names: [c1.name, c2.name], q: d.q, choices: [r1.choice, r2.choice], agree: B.cp.agree });
  ctx.go('battle');
}

