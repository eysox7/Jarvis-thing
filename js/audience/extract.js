// Metinden mesaj özelliklerini çıkarır (çevrimdışı, sözlük tabanlı, açıklanabilir).
// Kurumun elindeki gerçek duyuru/afiş/tweet metni → alan, çerçeve, duruş, ticarilik, kanıt düzeyi…
// Her çıkarım hangi kelimelere dayandığını `kanit` alanında gösterir; kullanıcı açıkça
// verdiği alanlarla her zaman ezebilir. Model gerektirmez; isteyen ajan LLM ile de doldurabilir.

const norm = (s) => String(s || '').toLocaleLowerCase('tr').normalize('NFC');

/** Kök eşleşmesi: sözcük başında aranır ("kaybet" → "kaybetmeyin", "kaybettiniz"). */
function hits(text, roots) {
  const found = [];
  for (const r of roots) {
    const re = new RegExp('(^|[^\\p{L}])' + r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u');
    if (re.test(text)) found.push(r);
  }
  return found;
}

const DOMAIN_LEX = {
  siyaset: ['seçim', 'parti', 'meclis', 'oy ', 'oyunu', 'milletvekil', 'iktidar', 'muhalefet', 'cumhurbaşkan', 'hükümet', 'siyas', 'demokrasi', 'anayasa', 'sandık', 'irade', 'miting', 'yolsuzluk', 'ihale', 'kamuoyu', 'bakan'],
  saglik: ['sağlık', 'aşı', 'hastal', 'hastane', 'doktor', 'tedavi', 'virüs', 'salgın', 'kanser', 'ilaç', 'tansiyon', 'diyabet', 'check-up', 'tarama'],
  ticaret: ['indirim', 'kampanya', 'satın', 'sipariş', 'ürün', 'mağaza', 'fiyat', 'kargo', 'sepet', 'müşteri', 'marka'],
  egitim: ['okul', 'öğrenci', 'öğretmen', 'eğitim', 'sınav', 'burs', 'kurs', 'üniversite', 'ders', 'mezun'],
  kultur: ['konser', 'film', 'dizi', 'festival', 'sergi', 'tiyatro', 'müzik', 'sanat', 'kitap', 'sinema'],
  spor: ['maç', 'takım', 'gol', 'lig', 'taraftar', 'şampiyon', 'transfer', 'stadyum', 'antrenör', 'spor'],
  bilim: ['araştırma', 'bilim', 'teknoloji', 'yapay zeka', 'deney', 'keşif', 'uzay', 'yazılım', 'inovasyon', 'laboratuvar'],
  kriz: ['deprem', 'afet', 'sel', 'yangın', 'tahliye', 'acil', 'kriz', 'arama kurtarma', 'uyarı', 'fırtına'],
  cevre: ['iklim', 'çevre', 'karbon', 'geri dönüşüm', 'orman', 'su tasarruf', 'kirlilik', 'yeşil', 'sürdürülebilir', 'emisyon', 'atık'],
  finans: ['faiz', 'enflasyon', 'borsa', 'döviz', 'kredi', 'yatırım', 'vergi', 'bütçe', 'ekonomi', 'maaş', 'emekli'],
  din: ['cami', 'dua', 'ibadet', 'ramazan', 'bayram', 'inanç', 'kutsal', 'din', 'hayır', 'zekat', 'kurban'],
  kamu_hizmeti: ['belediye', 'ulaşım', 'otobüs', 'metro', 'su kesinti', 'yol çalışma', 'park', 'çöp', 'başvuru', 'e-devlet', 'hizmet'],
};

const FRAME_LEX = {
  kayip: ['kaybet', 'kaçırma', 'risk', 'zarar', 'mahrum', 'yoksa', 'aksi halde', 'geç kalma'],
  kazanc: ['kazan', 'fırsat', 'avantaj', 'fayda', 'tasarruf', 'hediye', 'ücretsiz', 'bedava', 'indirim'],
  korku: ['ölüm', 'ölür', 'ölebilir', 'felaket', 'tehlike', 'korkunç', 'dehşet', 'tehdit', 'hayati'],
  umut: ['umut', 'gelecek', 'birlikte başar', 'hayal', 'ilham', 'mümkün', 'daha iyi', 'yarın'],
  ahlaki: ['vicdan', 'ahlak', 'değer', 'kutsal', 'adalet', 'haram', 'helal', 'onur', 'erdem', 'günah'],
  ekonomik: [' tl', '₺', 'maliyet', 'ekonomi', 'bütçe', 'fiyat', 'ücret', 'milyon', 'milyar', 'gelir'],
  catisma: ['karşı', 'mücadele', 'düşman', 'savaş', 'rakip', 'saldırı', 'yalan', 'ihanet', 'hesap soracağ'],
  insan_hikayesi: ['hikaye', 'hikâye', 'annesi', 'babası', 'yaşındaki', 'çocuğu', 'ailesi', 'hayatı', 'gözyaşı', 'anlatıyor'],
  sorumluluk: ['sorumlu', 'görev', 'yükümlü', 'hesap ver', 'ihmal', 'herkesin görevi', 'üzerimize düş', 'çözüm'],
};

const EVIDENCE = ['araştırma', 'veri', 'istatistik', 'kaynak', 'rapor', 'bilimsel', 'uzman', 'çalışma', 'kanıt', 'göre'];
const CUES = ['ünlü', 'yıldız', 'muhteşem', 'harika', 'inanılmaz', 'efsane', '🔥', '❤', '😍'];
const COMMERCIAL = ['indirim', 'satın', 'sipariş', 'kampanya', 'fiyat', 'sepet', 'kupon', 'abone ol', 'hemen al', 'stoklarla'];
const COUNTER = ['direniş', 'eşitsizlik', 'sömürü', 'protesto', 'haklarımız', 'hak gasp', 'özgürlük', 'baskı', 'adalet istiyoruz', 'grev', 'boykot', 'yolsuzluk'];
const DOMINANT = ['milli', 'devletimiz', 'birlik ve beraberlik', 'istikrar', 'güçlü türkiye', 'resmi', 'talimat', 'mevzuat', 'genelge', 'yetkili'];
const INCLUSIVE = ['herkes', 'kadın', 'engelli', 'eşit hak', 'eşit fırsat', 'kapsayıcı', 'çeşitlilik', 'erişilebilir', 'göçmen', 'lgbt', 'yaşlı', 'genç'];
const STEREO = ['kadın işi', 'erkek gibi', 'hanımlar için', 'kız gibi', 'erkek adam'];
const NOVELTY = ['yeni', 'ilk kez', 'lansman', 'tanıtıyoruz', 'yenilik', 'ilk defa', 'artık', 'pilot uygulama'];
const LEFT = ['emekçi', 'işçi', 'sendika', 'eşitlik', 'sosyal adalet', 'laik', 'kamusal'];
const RIGHT = ['milli', 'manevi', 'aile değer', 'ecdad', 'gelenek', 'beka', 'yerli ve milli'];

const best = (lex, t) => {
  let top = null, topHits = [];
  for (const [k, roots] of Object.entries(lex)) {
    const h = hits(t, roots);
    if (h.length > topHits.length) { top = k; topHits = h; }
  }
  return [top, topHits];
};
const sat = (k, per = 0.25) => Math.min(1, k * per);

/**
 * @param {string} text
 * @returns {{message: object, kanit: object}}  message predict()'e verilebilir (yalnızca bulunan alanlar)
 */
export function extractMessage(text) {
  const t = ' ' + norm(text) + ' ';
  const message = {}, kanit = {};
  const [dom, dh] = best(DOMAIN_LEX, t);
  if (dom) { message.domain = dom; kanit.alan = dh; }
  const [fr, fh] = best(FRAME_LEX, t);
  if (fr) { message.frame = fr; kanit.cerceve = fh; }

  const ev = hits(t, EVIDENCE), nums = (t.match(/\d+([.,]\d+)?\s*%|%\s*\d+|\d{2,}/g) || []).length;
  message.quality = Math.round((0.35 + sat(ev.length, 0.15) + sat(nums, 0.1) * 0.5) * 100) / 100;
  message.quality = Math.min(1, message.quality);
  kanit.arguman = [...ev, ...(nums ? [`${nums} sayısal veri`] : [])];

  const cu = hits(t, CUES), excl = (t.match(/!/g) || []).length;
  message.cues = Math.round(Math.min(1, 0.4 + sat(cu.length, 0.12) + sat(excl, 0.05)) * 100) / 100;
  if (cu.length) kanit.cevresel = cu;

  const co = hits(t, COMMERCIAL);
  if (co.length) { message.commercial = Math.min(1, 0.3 + sat(co.length, 0.25)); kanit.ticari = co; }

  const ctr = hits(t, COUNTER), dmn = hits(t, DOMINANT);
  if (ctr.length || dmn.length) {
    message.hegemonic = Math.max(-1, Math.min(1, (dmn.length - ctr.length) * 0.4));
    kanit.durus = { egemen: dmn, karsi: ctr };
  }

  const le = hits(t, LEFT), ri = hits(t, RIGHT);
  if (le.length || ri.length) { message.slant = Math.max(-1, Math.min(1, (ri.length - le.length) * 0.35)); kanit.egilim = { sol: le, sag: ri }; }

  const inc = hits(t, INCLUSIVE), st = hits(t, STEREO);
  if (inc.length || st.length) { message.representation = Math.max(-1, Math.min(1, inc.length * 0.25 - st.length * 0.6)); kanit.temsil = { kapsayici: inc, kalip: st }; }

  const nv = hits(t, NOVELTY);
  if (nv.length) { message.novelty = Math.min(1, 0.3 + sat(nv.length, 0.2)); kanit.yenilik = nv; }

  return { message, kanit };
}
