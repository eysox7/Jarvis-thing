// Eller serbest kontrol: uyandırma kelimesi → dinle → çalıştır → sesli cevapla → tekrar dinle.
// Telefona hiç dokunmadan kullanım hedeflenir; onay ve soru pencereleri de sesle cevaplanır.

import * as Speech from './speech.js';

/* -------------------- Türkçe niyet çözümleme -------------------- */

const norm = (s) => String(s || '')
  .toLocaleLowerCase('tr')
  .replace(/[.,!?;:"']/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// Ses tanıma "nexus"u sıkça yanlış yazar; yakın okunuşları da kabul et.
const WAKE_VARIANTS = ['nexus', 'neksus', 'neksüs', 'nexsus', 'neksis', 'nekzus', 'next us'];

const YES = /^(evet|tamam|olur|onayla|onaylıyorum|peki|kabul|kabul ediyorum|devam|devam et|yap|yapalım|olsun|hı hı|aynen|doğru|başlat|onay)\b/;
const NO = /^(hayır|hayir|yok|olmaz|iptal|vazgeç|vazgectim|vazgeçtim|dur|durdur|istemiyorum|reddet|gerek yok|boşver|boş ver)\b/;

export function parseYesNo(text) {
  const t = norm(text);
  if (!t) return null;
  if (YES.test(t)) return true;
  if (NO.test(t)) return false;
  // Cümle içinde geçiyorsa da yakala.
  if (/\b(evet|onayla|tamam|devam et|olur)\b/.test(t)) return true;
  if (/\b(hayır|iptal|vazgeç|reddet|olmaz|istemiyorum)\b/.test(t)) return false;
  return null;
}

/** Uyandırma kelimesini arar; bulursa kalan komutu döndürür. */
export function matchWake(text, wakeWord) {
  const t = norm(text);
  const words = [norm(wakeWord || 'nexus'), ...WAKE_VARIANTS].filter(Boolean);
  for (const w of words) {
    const i = t.indexOf(w);
    if (i < 0) continue;
    // Kelime sınırında mı? ("annexus" tetiklemesin.
    const before = i === 0 ? ' ' : t[i - 1];
    if (before !== ' ') continue;
    return { hit: true, rest: t.slice(i + w.length).replace(/^(\s*(hey|ya|bak))?\s*/, '').trim() };
  }
  return { hit: false, rest: '' };
}

/** Modele gitmeden yerelde karşılanan kontrol komutları. */
const LOCAL = [
  { id: 'sleep', re: /^(uyu|dinlemeyi (durdur|kapat|bırak)|eller serbest(i)? (kapat|kapa|kapan)|sesli (modu|kontrolü) kapat|kapan|kapat kendini)\b/ },
  { id: 'stop', re: /^(dur|durdur|sus|sessiz ol|kes|iptal)\b/ },
  { id: 'repeat', re: /^(tekrarla|tekrar et|ne dedin|bir daha söyle|anlamadım)\b/ },
  { id: 'newchat', re: /^(yeni sohbet|sohbeti temizle|baştan başla|sıfırla)\b/ },
  { id: 'help', re: /^(ne yapabilirsin|yardım|komutlar( nedir)?)\b/ },
];

export function matchLocal(text) {
  const t = norm(text);
  return LOCAL.find((c) => c.re.test(t))?.id || null;
}

/* -------------------- durum makinesi -------------------- */

export const STATES = {
  off: 'kapalı',
  wake: 'uyandırma kelimesi bekleniyor',
  command: 'dinliyorum',
  thinking: 'çalışıyorum',
  speaking: 'konuşuyorum',
  asking: 'cevabını bekliyorum',
};

export class Voice {
  /**
   * @param {object} o
   *   getSettings() -> ayarlar
   *   onState(state, label)
   *   onPartial(text)      — canlı yazıya dökme
   *   onCommand(text)      — ajana gidecek komut
   *   onLocal(id)          — yerel kontrol komutu
   *   onError(err, soft)
   */
  constructor(o) {
    this.o = o;
    this.state = 'off';
    this.handle = null;
    this.wakeLock = null;
    this.awaitingCommand = false;
    this.awaitTimer = null;
    this.pendingCapture = null;   // {resolve, yesNo, tries, question, options}
    this.lastSpoken = '';
    this._onVisibility = this._onVisibility.bind(this);
  }

  get active() { return this.state !== 'off'; }
  get settings() { return this.o.getSettings(); }

  _set(state) {
    this.state = state;
    this.o.onState?.(state, STATES[state] || state);
  }

  /* ---------------- açma / kapama ---------------- */

  async start() {
    if (this.active) return true;
    if (!Speech.sttSupported) {
      this.o.onError?.(new Error('Bu tarayıcı sesli girişi desteklemiyor. Chrome, Edge veya Safari dene.'));
      return false;
    }
    const st = this.settings;
    this.handle = Speech.listenContinuous({
      lang: st.lang || 'tr-TR',
      onPartial: (t) => this.o.onPartial?.(t),
      onFinal: (t) => this._heard(t),
      onError: (e, soft) => {
        this.o.onError?.(e, soft);
        if (!soft) this.stop();
      },
    });
    if (!this.handle) return false;

    this._set(st.requireWake === false ? 'command' : 'wake');
    await this._acquireWakeLock();
    document.addEventListener('visibilitychange', this._onVisibility);
    // İlk açılışta sesli teyit — kullanıcı ekrana bakmıyor olabilir.
    this.say(st.requireWake === false
      ? 'Eller serbest açık. Dinliyorum.'
      : `Eller serbest açık. Beni "${st.wakeWord || 'Nexus'}" diyerek çağır.`);
    return true;
  }

  stop(silent = false) {
    if (!this.active && !this.handle) return;
    clearTimeout(this.awaitTimer);
    this.handle?.stop();
    this.handle = null;
    this.awaitingCommand = false;
    if (this.pendingCapture) { this.pendingCapture.resolve(null); this.pendingCapture = null; }
    Speech.stopSpeaking();
    this._releaseWakeLock();
    document.removeEventListener('visibilitychange', this._onVisibility);
    this._set('off');
    if (!silent) Speech.speak('Dinlemeyi kapatıyorum.', { lang: this.settings.lang });
  }

  async toggle() { return this.active ? (this.stop(), false) : this.start(); }

  /* ---------------- ekran kilidi ---------------- */

  async _acquireWakeLock() {
    try {
      if ('wakeLock' in navigator) this.wakeLock = await navigator.wakeLock.request('screen');
    } catch { /* pil tasarrufu vb. engelleyebilir, kritik değil */ }
  }
  _releaseWakeLock() {
    try { this.wakeLock?.release(); } catch { /* yoksay */ }
    this.wakeLock = null;
  }
  async _onVisibility() {
    if (document.visibilityState === 'visible' && this.active) {
      if (!this.wakeLock) await this._acquireWakeLock();
      // Sekme geri gelince tanıma ölmüş olabilir; nazikçe canlandır.
      if (this.state === 'wake' || this.state === 'command') this.handle?.resume();
    }
  }

  /* ---------------- duyulan metnin yönlendirilmesi ---------------- */

  _heard(text) {
    const raw = String(text || '').trim();
    if (!raw) return;

    // 1) Bir soru/onay bekleniyorsa cevap oraya gider.
    if (this.pendingCapture) return this._answerCapture(raw);

    // 2) Ajan çalışıyor veya konuşuyorsak: yalnızca "dur" türü komutları dinle.
    if (this.state === 'thinking' || this.state === 'speaking') {
      if (matchLocal(raw) === 'stop') this.o.onLocal?.('stop');
      return;
    }

    // 3) Uyandırma kelimesi kapısı.
    const st = this.settings;
    let command = raw;
    if (st.requireWake !== false && !this.awaitingCommand) {
      const { hit, rest } = matchWake(raw, st.wakeWord);
      if (!hit) return;                       // bize söylenmedi, yoksay
      if (!rest) {                            // sadece isim: komut bekle
        this.awaitingCommand = true;
        this._set('command');
        clearTimeout(this.awaitTimer);
        this.awaitTimer = setTimeout(() => {
          this.awaitingCommand = false;
          if (this.state === 'command') this._set('wake');
        }, 12000);
        this.say('Efendim?');
        return;
      }
      command = rest;
    }

    clearTimeout(this.awaitTimer);
    this.awaitingCommand = false;

    // 4) Yerel kontrol komutu mu?
    const local = matchLocal(command);
    if (local) { this.o.onLocal?.(local); return; }

    // 5) Ajana gönder.
    this.o.onCommand?.(command);
  }

  /* ---------------- ajan yaşam döngüsü kancaları ---------------- */

  /** Ajan çalışırken mikrofonu serbest bırakmıyoruz ama komut dinlemiyoruz. */
  agentStart() { this._set('thinking'); }

  async agentEnd(replyText) {
    if (!this.active) return;
    if (replyText) await this.say(replyText);
    this._backToIdle();
  }

  _backToIdle() {
    if (!this.active) return;
    this._set(this.settings.requireWake === false ? 'command' : 'wake');
    this.handle?.resume();
  }

  /* ---------------- konuşma ---------------- */

  /** Konuşurken mikrofonu duraklatır (hoparlör sesini kendi komutu sanmasın). */
  async say(text) {
    if (!text) return;
    this.lastSpoken = text;
    const st = this.settings;
    const prev = this.state;
    if (this.active) this._set('speaking');
    if (!st.bargeIn) this.handle?.pause();
    try {
      await Speech.speak(text, { lang: st.lang || 'tr-TR', rate: Number(st.voiceRate) || 1.05 });
    } finally {
      if (!st.bargeIn) this.handle?.resume();
      if (this.active && this.state === 'speaking') this._set(prev === 'speaking' ? 'wake' : prev);
    }
  }

  repeatLast() {
    if (this.lastSpoken) this.say(this.lastSpoken);
    else this.say('Tekrarlayacak bir şey yok.');
  }

  /* ---------------- sesle onay ve soru ---------------- */

  /**
   * Soruyu sesli sorar ve cevabı bekler. Ekrandaki pencere de açık kalır;
   * kullanıcı isterse dokunarak cevaplayabilir (bu durumda cancel() çağrılır).
   * @returns {Promise<string|null>}
   */
  captureAnswer(question, { yesNo = false, options = [] } = {}) {
    return new Promise((resolve) => {
      this.pendingCapture = { resolve, yesNo, options, tries: 0, question };
      this._set('asking');
      const opts = options.length ? ` Seçenekler: ${options.join(', ')}.` : '';
      this.say(question + opts + (yesNo ? ' Evet mi, hayır mı?' : ''))
        .then(() => { this.handle?.resume(); });
    });
  }

  _answerCapture(raw) {
    const p = this.pendingCapture;
    if (!p) return;

    if (p.yesNo) {
      const v = parseYesNo(raw);
      if (v === null) {
        p.tries++;
        if (p.tries >= 2) {
          this.pendingCapture = null;
          p.resolve(null);                    // karar veremedik: ekrana bırak
          this.say('Anlayamadım, ekrandan seçebilirsin.');
          return;
        }
        this.say('Anlayamadım. Evet mi, hayır mı?');
        return;
      }
      this.pendingCapture = null;
      p.resolve(v ? 'evet' : 'hayır');
      return;
    }

    // Serbest cevap: seçenek listesi varsa en yakınını eşle.
    let answer = raw;
    if (p.options?.length) {
      const t = norm(raw);
      const hit = p.options.find((o) => t.includes(norm(o)) || norm(o).includes(t));
      if (hit) answer = hit;
    }
    this.pendingCapture = null;
    p.resolve(answer);
  }

  /** Ekrandan cevaplandıysa sesli yakalamayı iptal et. */
  cancelCapture() {
    if (!this.pendingCapture) return;
    this.pendingCapture.resolve(null);
    this.pendingCapture = null;
    Speech.stopSpeaking();
    if (this.active) this._set('thinking');
  }

  helpText() {
    const w = this.settings.wakeWord || 'Nexus';
    return `Beni ${w} diyerek çağır, sonra ne isteyeceğini söyle. `
      + 'Görev ekleyebilir, listeleyebilir, hatırlatma kurabilir, hesap yapabilirim. '
      + 'Konuşurken kesmek için "dur", baştan başlamak için "yeni sohbet", '
      + 'dinlemeyi kapatmak için "uyu" de.';
  }
}
