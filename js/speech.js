// Ses giriş (Web Speech API) ve çıkış (SpeechSynthesis). Desteklenmeyen cihazlarda sessizce devre dışı.

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export const sttSupported = !!SR;
export const ttsSupported = 'speechSynthesis' in window;

let rec = null;
let active = false;

/**
 * Dinlemeyi başlatır/durdurur.
 * @param {{lang:string, onPartial:Function, onFinal:Function, onEnd:Function, onError:Function}} o
 */
export function toggleListen(o) {
  if (!SR) { o.onError?.(new Error('Bu tarayıcı sesli girişi desteklemiyor.')); return false; }
  if (active) { stopListen(); return false; }

  rec = new SR();
  rec.lang = o.lang || 'tr-TR';
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;

  let finalText = '';
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    o.onPartial?.((finalText + ' ' + interim).trim());
  };
  rec.onerror = (e) => {
    active = false;
    const map = {
      'not-allowed': 'Mikrofon izni verilmedi.',
      'no-speech': 'Ses algılanmadı.',
      'network': 'Ses tanıma için internet gerekli.',
      'audio-capture': 'Mikrofon bulunamadı.',
    };
    o.onError?.(new Error(map[e.error] || ('Ses hatası: ' + e.error)));
    o.onEnd?.();
  };
  rec.onend = () => {
    active = false;
    if (finalText.trim()) o.onFinal?.(finalText.trim());
    o.onEnd?.();
  };

  try { rec.start(); active = true; return true; }
  catch (e) { active = false; o.onError?.(e); return false; }
}

export function stopListen() {
  active = false;
  try { rec?.stop(); } catch { /* yoksay */ }
}

export const isListening = () => active;

export function speak(text, lang = 'tr-TR') {
  if (!ttsSupported || !text) return;
  try {
    speechSynthesis.cancel();
    // Uzun metinleri kırp; TTS motorları çok uzun girdide takılıyor.
    const u = new SpeechSynthesisUtterance(String(text).replace(/[*_`#>]/g, '').slice(0, 600));
    u.lang = lang;
    u.rate = 1.05;
    speechSynthesis.speak(u);
  } catch { /* yoksay */ }
}

export function stopSpeaking() {
  if (ttsSupported) { try { speechSynthesis.cancel(); } catch { /* yoksay */ } }
}
