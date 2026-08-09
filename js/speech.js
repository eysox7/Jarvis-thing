// Ses ilkelleri: tanıma (Web Speech API) ve sentez (SpeechSynthesis).
// Aynı anda yalnızca tek bir tanıma örneği çalışabilir; bu modül o tekliği garanti eder.

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export const sttSupported = !!SR;
export const ttsSupported = 'speechSynthesis' in window;

let current = null;          // etkin tanıma örneği
let currentKind = null;      // 'once' | 'continuous'

export const isListening = () => !!current;
export const listeningKind = () => currentKind;

function release(inst) {
  if (current === inst) { current = null; currentKind = null; }
}

/** Tanımayı derhal serbest bırak (bas-konuş ve sürekli mod için ortak). */
export function stopListen() {
  const inst = current;
  release(inst);
  try { inst?.abort?.(); } catch { /* yoksay */ }
}

/* ------------------------------------------------------------------ */
/* Bas-konuş: tek seferlik dinleme                                     */
/* ------------------------------------------------------------------ */

export function listenOnce({ lang = 'tr-TR', onPartial, onFinal, onEnd, onError } = {}) {
  if (!SR) { onError?.(new Error('Bu tarayıcı sesli girişi desteklemiyor.')); return false; }
  stopListen();

  const rec = new SR();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  current = rec; currentKind = 'once';

  let finalText = '';
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    onPartial?.((finalText + ' ' + interim).trim());
  };
  rec.onerror = (e) => { release(rec); onError?.(new Error(errorText(e.error))); };
  rec.onend = () => {
    release(rec);
    if (finalText.trim()) onFinal?.(finalText.trim());
    onEnd?.();
  };

  try { rec.start(); return true; }
  catch (e) { release(rec); onError?.(e); return false; }
}

/* ------------------------------------------------------------------ */
/* Sürekli dinleme (eller serbest)                                     */
/* ------------------------------------------------------------------ */

/**
 * Kapanana kadar dinlemeyi sürdürür. Tarayıcı sessizlikte oturumu kapatırsa
 * kendini yeniden başlatır — mobil Chrome bunu sık yapar.
 * @returns {{stop:Function, pause:Function, resume:Function, paused:()=>boolean}}
 */
export function listenContinuous({ lang = 'tr-TR', onPartial, onFinal, onError, onRestart } = {}) {
  if (!SR) { onError?.(new Error('Bu tarayıcı sesli girişi desteklemiyor.')); return null; }

  let alive = true;
  let paused = false;
  let rec = null;
  let restarts = 0;
  let restartTimer = null;

  const spawn = () => {
    if (!alive || paused) return;
    stopListen();
    const r = new SR();
    r.lang = lang;
    r.interimResults = true;
    r.continuous = true;
    r.maxAlternatives = 1;
    rec = r; current = r; currentKind = 'continuous';

    r.onresult = (e) => {
      restarts = 0;                       // sağlıklı sonuç geldi, hata sayacını sıfırla
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const txt = res[0].transcript.trim();
        if (res.isFinal) { if (txt) onFinal?.(txt); }
        else interim += res[0].transcript;
      }
      if (interim.trim()) onPartial?.(interim.trim());
    };

    r.onerror = (e) => {
      // İzin reddi kalıcıdır: yeniden denemek anlamsız.
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        alive = false;
        release(r);
        onError?.(new Error(errorText(e.error)));
        return;
      }
      // 'no-speech' ve 'aborted' normal akışın parçası; sessizce yeniden başlar.
      if (e.error !== 'no-speech' && e.error !== 'aborted') onError?.(new Error(errorText(e.error)), true);
    };

    r.onend = () => {
      release(r);
      if (!alive || paused) return;
      // Üst üste hızlı bitişlerde araya artan gecikme koy (sonsuz döngü koruması).
      restarts++;
      const delay = Math.min(300 * restarts, 4000);
      if (restarts > 3) onRestart?.(restarts);
      clearTimeout(restartTimer);
      restartTimer = setTimeout(spawn, delay);
    };

    try { r.start(); }
    catch { release(r); clearTimeout(restartTimer); restartTimer = setTimeout(spawn, 400); }
  };

  spawn();

  return {
    stop() { alive = false; clearTimeout(restartTimer); release(rec); try { rec?.abort(); } catch { /* yoksay */ } },
    pause() { if (paused) return; paused = true; clearTimeout(restartTimer); release(rec); try { rec?.abort(); } catch { /* yoksay */ } },
    resume() { if (!paused || !alive) return; paused = false; restarts = 0; clearTimeout(restartTimer); restartTimer = setTimeout(spawn, 220); },
    paused: () => paused,
    alive: () => alive,
  };
}

function errorText(code) {
  return {
    'not-allowed': 'Mikrofon izni verilmedi. Tarayıcı ayarlarından izin ver.',
    'service-not-allowed': 'Ses tanıma servisine izin verilmedi.',
    'no-speech': 'Ses algılanmadı.',
    'network': 'Ses tanıma için internet gerekli.',
    'audio-capture': 'Mikrofon bulunamadı.',
    'aborted': 'Dinleme kesildi.',
  }[code] || ('Ses hatası: ' + code);
}

/* ------------------------------------------------------------------ */
/* Sesli okuma                                                         */
/* ------------------------------------------------------------------ */

let speaking = false;
export const isSpeaking = () => speaking;

/** Markdown işaretlerini ve okunmayacak gürültüyü ayıklar. */
function forSpeech(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' (kod bloğu) ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*|__|[*_#>]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' bağlantı ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Uzun metni cümlelere böler: TTS motorları çok uzun girdide susuyor. */
function chunk(text, max = 180) {
  const parts = [];
  let buf = '';
  for (const piece of text.split(/(?<=[.!?…:\n])\s+/)) {
    if ((buf + ' ' + piece).trim().length > max) {
      if (buf) parts.push(buf.trim());
      // Tek başına da uzunsa sert kes.
      let rest = piece;
      while (rest.length > max) { parts.push(rest.slice(0, max)); rest = rest.slice(max); }
      buf = rest;
    } else buf = (buf + ' ' + piece).trim();
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

/**
 * Metni okur. Tüm parçalar bitince (veya iptal edilince) çözülür.
 * @returns {Promise<{cancelled:boolean}>}
 */
export function speak(text, { lang = 'tr-TR', rate = 1.05 } = {}) {
  if (!ttsSupported) return Promise.resolve({ cancelled: true });
  const clean = forSpeech(text);
  if (!clean) return Promise.resolve({ cancelled: true });

  stopSpeaking();
  const parts = chunk(clean);
  speaking = true;

  return new Promise((resolve) => {
    let i = 0;
    let done = false;
    let watchdog = null;
    const finish = (cancelled) => {
      if (done) return;
      done = true; speaking = false;
      clearTimeout(watchdog);
      resolve({ cancelled });
    };

    const step = () => { clearTimeout(watchdog); return speaking ? next() : finish(true); };

    const next = () => {
      if (!speaking) return finish(true);
      if (i >= parts.length) return finish(false);
      const text = parts[i++];
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = rate;
      u.onend = step;
      u.onerror = step;
      try { speechSynthesis.speak(u); }
      catch { return finish(true); }
      // Bazı cihazlarda (ses paketi yoksa, sekme arka plandaysa) onend hiç gelmez.
      // Bekçi olmazsa eller serbest döngüsü "konuşuyorum"da kilitlenir ve bir daha
      // dinlemeye dönmez; bu yüzden makul bir süre sonra kendiliğinden ilerliyoruz.
      clearTimeout(watchdog);
      watchdog = setTimeout(step, Math.max(3000, (text.length / Math.max(rate, 0.5)) * 110));
    };

    // Bazı tarayıcılarda kuyruk 'cancel' sonrası bir tik gecikmeli boşalıyor.
    setTimeout(next, 40);
  });
}

export function stopSpeaking() {
  speaking = false;
  if (ttsSupported) { try { speechSynthesis.cancel(); } catch { /* yoksay */ } }
}
