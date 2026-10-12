// KVKK aydınlatma metni + açık rıza. TASLAKTIR: yayına almadan önce bir hukukçuya
// okutulmalı ve [köşeli parantezli] alanlar doldurulmalıdır.
import { S, save } from './store.js';
import { sha256 } from './util.js';

export const CONSENT_VERSION = '0.1-taslak';

export const NOTICE = `
<h4>Aydınlatma Metni (6698 sayılı KVKK md. 10)</h4>
<p><b>Veri sorumlusu:</b> [Şirket unvanı, adresi, MERSİS no, iletişim e-postası]</p>
<p><b>İşlenen veriler:</b> takma adın, kendini tanıttığın kısa metin, karar testindeki
seçimlerin ve yanıt süren, yüklemeyi seçtiğin metin/mesaj dosyalarındaki <i>yalnızca senin</i>
mesajların ve bunlardan çıkarılan yazım tarzı özeti.</p>
<p><b>Amaç:</b> senin karar verme biçimini taklit eden dijital bir klon modeli oluşturmak,
klonun senin gibi karar verip vermediğini ölçmek ve arkadaşlarınla oyunlaştırılmış
karşılaştırmalar (Arena) yapabilmek.</p>
<p><b>Hukuki sebep:</b> açık rızan (KVKK md. 5/1).</p>
<p><b>Nerede işlenir:</b> bu prototipte tüm işleme <b>senin cihazında</b> yapılır. Yapay zeka
modeli telefonuna indirilir ve orada çalışır; verilerin bir sunucuya gönderilmez.
Model dosyasının indirilmesi senden bir veri aktarımı içermez.</p>
<p><b>Aktarım:</b> yalnızca sen "Klon kartımı paylaş" dersen, kartın (takma ad, kişilik DNA'sı,
karar testindeki seçimlerin, kısa tanıtımın) seçtiğin kişilere iletilir. Ham dosyaların
ve mesajların hiçbir zaman karta girmez.</p>
<p><b>Saklama süresi:</b> sen silene ya da rızanı geri çekene kadar, yalnızca bu cihazda.</p>
<p><b>Hakların (KVKK md. 11):</b> verilerinin işlenip işlenmediğini öğrenme, bilgi talep etme,
düzeltme, silme, işlemeye itiraz etme. Uygulama içinden: <i>Ayarlar → Verilerimi indir</i> ve
<i>Rızamı geri çek ve her şeyi sil</i>. Diğer talepler: [başvuru adresi].</p>
<p><b>Lütfen yükleme:</b> sağlık, din, siyasi görüş, cinsel hayat, biyometrik veri gibi
<b>özel nitelikli kişisel veri</b> içeren dosyalar. Klon bunlara ihtiyaç duymaz.</p>
`;

export const ITEMS = [
  { key: 'process', required: true, text: 'Karar testi seçimlerimin ve kendimle ilgili yazdıklarımın, dijital klonumun oluşturulması ve kararlarımla karşılaştırılması amacıyla cihazımda işlenmesine <b>açık rıza</b> veriyorum.' },
  { key: 'adult', required: true, text: '18 yaşından büyüğüm.' },
  { key: 'files', required: false, text: '<i>(İsteğe bağlı)</i> Yüklediğim mesaj/metin dosyalarının klonumu beslemek için işlenmesine açık rıza veriyorum. Bu dosyalarda başkalarının mesajları bulunabileceğini ve uygulamanın <b>yalnızca benim mesajlarımı</b> tutacağını biliyorum.' },
  { key: 'share', required: false, text: '<i>(İsteğe bağlı)</i> Klon kartımın, kendi seçtiğim arkadaşlarla Arena\'da karşılaştırılmak üzere paylaşılmasına açık rıza veriyorum.' },
];

export async function record(items) {
  S.consent = {
    version: CONSENT_VERSION,
    textHash: await sha256(NOTICE + ITEMS.map((i) => i.text).join('|')),
    items,
    at: new Date().toISOString(),
  };
  save();
}

export const has = (key) => !!S.consent?.items?.[key];
