import { h } from './util.js';
import { getLang } from './i18n.js';

// Google ile giriş düğmesi (Google Identity Services). Düğme Google'ın kendi bileşenidir; seçilen
// hesabın kimlik belgesi (credential) geri çağrıyla gelir ve sunucuya gider (/api/auth/google).
// Sunucuda istemci kimliği tanımlı değilse (config.googleClientId boş) hiç gösterilmez.
let loading = null;

function loadScript() {
  loading ??= new Promise((resolve, reject) => {
    const script = h('script', { src: 'https://accounts.google.com/gsi/client', async: true });
    script.onload = resolve;
    script.onerror = () => {
      loading = null;
      reject(new Error('gsi_unavailable'));
    };
    document.head.append(script);
  });
  return loading;
}

// Düğmeyi bir kutuya çizer; Google'a ulaşılamazsa kutu gizli kalır.
export function googleButton(clientId, onCredential) {
  const box = h('div', { class: 'google-button', hidden: true });
  loadScript().then(() => {
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: ({ credential }) => onCredential(credential),
      auto_select: false,
      itp_support: true,
    });
    window.google.accounts.id.renderButton(box, { theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill', locale: getLang() });
    box.hidden = false;
  }).catch(() => {});
  return box;
}
