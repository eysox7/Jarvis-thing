# Tahliye Laboratuvarı — AlphaZero × MatrAIx

Kalabalık güvenliği için bir deney: **MatrAIx** personalarından ölçülen insan davranışıyla
kalibre edilen bir kalabalık simülatöründe, **AlphaZero** ile tahliye anonsu stratejisi öğrenmek.

Amaç kitleyi bir fikre yönlendirmek değil, **ezilme riskini azaltmak ve herkesi daha hızlı
dışarı çıkarmak**. Ödül fonksiyonu bunu kodlar: tahliye süresi + tehlikeli yoğunluk cezası.

> Bu bir araştırma prototipidir. Simülasyon gerçeğin yerini tutmaz; çıkan her plan gerçek
> insanlarla ve güvenlik uzmanlarıyla doğrulanmadan uygulanmamalıdır. Son karar her zaman insanda.

## Neden bu ikisi birlikte?

AlphaZero oyunlarda süper insan seviyesine çıkar çünkü kusursuz bir simülatörü (oyunun kuralları)
vardır. Kitle psikolojisinde böyle bir simülatör yoktur. MatrAIx, binlerce farklı personayı LLM
ajanı olarak çalıştırıp "bu anonsu duyan bu kişi ne yapar?" sorusuna cevap üretir. Ama LLM
çağrısı yavaştır; AlphaZero'nun milyonlarca ileri sarmasına doğrudan sığmaz. Bu yüzden:

```
            ┌───────────────── yavaş, nadiren ─────────────────┐
MatrAIx personaları ──anket──► calibrate.py ──► persona-params.json
                                                         │
            ┌──────────────── hızlı, milyonlarca kez ──────▼───────────┐
            │  social force simülatörü (sim.js) + persona davranışı      │
            │        ▲                                   │                │
            │   hamle│(anons / kapı)          durum + sonuç│               │
            │  AlphaZero: policy+value ağı (nn.js) + PUCT araması (mcts.js)│
            │             self-play → eğitim → arena (alphazero.js)       │
            └────────────────────────────────────────────────────────────┘
                                                         │ en iyi plan
MatrAIx personaları ◄──doğrulama anketi── export_plan.py ◄┘
        └──► "simülatör iyimser mi?" ──► yeniden kalibrasyon
```

MatrAIx davranışı **ölçer**, simülatör bu ölçümü **hızlandırır**, AlphaZero **arar**, MatrAIx
bulunan planı **yeniden sorgular**. Son halka önemlidir: AlphaZero simülatörün açıklarını bulup
sömürmekte çok iyidir (bu projenin geliştirilmesinde de oldu, aşağıya bak).

## Dosyalar

| Dosya | Ne yapar |
|---|---|
| `sim.js` | Helbing social force modeli; anons (kapı başı hoparlör, 12 m), tepki gecikmesi, sürü davranışı, alışkanlık, panik, anons yorgunluğu. Deterministik ve kopyalanabilir |
| `personas.js` | MatrAIx persona boyutlarından önsel davranış eşlemesi; kalibrasyon dosyasını yükleme |
| `env.js` | Tahliyeyi oyuna çevirir: 17 eylem, 173 boyutlu durum, maliyet ve sonuç (z) |
| `nn.js` | Saf JS iki başlı ağ (policy + value), Adam |
| `mcts.js` | AlphaZero PUCT araması, Dirichlet gürültüsü |
| `alphazero.js` | Self-play, deneyim tamponu, eğitim, arena; kural tabanlı kıyas |
| `cli.mjs`, `worker.mjs` | Komut satırı; oyunlar çekirdeklere paralel dağıtılır |
| `index.html` | Tarayıcıda canlı görselleştirme |
| `matraix/tasks/survey_evacuation-announcement-response/` | MatrAIx anket görevi (9 soru → 9 parametre) |
| `matraix/calibrate.py` | Anket sonuçları → `persona-params.json` |
| `matraix/export_plan.py` | Plan → MatrAIx doğrulama anketi; sonuçları simülatör varsayımıyla karşılaştırma |
| `SESSION_LOG.md` | Geliştirme günlüğü |

## Çalıştırma

Bağımlılık yok (Node 18+; MatrAIx betikleri için Python 3 + PyYAML).

```bash
cd lab/crowd-sim

# Eğit (4 çekirdekte ~20-30 dk)
node cli.mjs train --iters 30 --games 8 --sims 32

# Müdahalesiz / kural / AlphaZero karşılaştırması
node cli.mjs compare --seeds 8

# Tek bir senaryonun planını göster
node cli.mjs plan --seed 1

# Görselleştirme (repo kökünden ya da bu klasörden)
python3 -m http.server 8080   # → http://localhost:8080/lab/crowd-sim/
```

## Gerçek MatrAIx personalarıyla

Varsayılan olarak 5 **sentetik** örnek persona kullanılır (`personas.js` → `BUILTIN_PERSONAS`).
Bunlar MatrAIx verisi değildir. Gerçek veriyle:

```bash
# MatrAIx deposunda (https://github.com/MatrAIx-ai/MatrAIx-Persona-8B)
cp -R <bu-repo>/lab/crowd-sim/matraix/tasks/survey_evacuation-announcement-response application/tasks/
uv run python application/scripts/generate_application_job.py \
  --task application/tasks/survey_evacuation-announcement-response \
  --execution-mode auto --model-name anthropic/claude-sonnet-4-6 --sample-size 50
# yazdırılan harbor komutunu çalıştır

# Bu repoda
python3 matraix/calibrate.py --jobs <MatrAIx>/jobs/<job> \
  --personas <MatrAIx>/persona/datasets/<dataset> --out persona-params.json
node cli.mjs train --params persona-params.json --fresh

# Doğrulama döngüsü
node cli.mjs plan --seed 1 --json plan.json --params persona-params.json
python3 matraix/export_plan.py task --plan plan.json        # → MatrAIx'e kopyala, koş
python3 matraix/export_plan.py check --plan plan.json --jobs <MatrAIx>/jobs/<job2> --params persona-params.json
```

Anket koşmadan, sadece persona boyutlarıyla (önsel eşleme):
`python3 matraix/calibrate.py --personas <dataset klasörü> --out persona-params.json`

## Geliştirme sırasında öğrenilenler

Bunlar "neden böyle tasarlandı?" sorusunun cevapları:

1. **Salon geneli anons herkesi tek kapıya yığar.** İlk sürümde anonsu herkes duyuyordu; en son
   söylenen kapı tıkanıyordu. Gerçek sistemler bölgesel anons yapar → kapı başı hoparlör (12 m).
2. **AlphaZero simülatörün açıklarını sömürdü.** Doğrulama anketine çevrilen ilk plan,
   "Ana giriş tıkalı, ana girişi kullanın" diyordu ve aynı anonsu 9 kez tekrarlıyordu.
   Simülatörde insanlar tekrara alışmıyordu. Düzeltme: anons yorgunluğu (30 sn içinde her tekrar
   uyumu yarıya indirir), anlamsız anons yasağı, müdahale bedeli. *Bu, simülasyonla öğrenen her
   sistemin temel riskidir; doğrulama döngüsü tam bunun için var.*
3. **Eylem dengesizliği.** 17 eylemin 16'sı müdahale olduğundan tekdüze başlayan ağ sürekli anons
   yapıyordu. "Bekle" eylemine başlangıç önceliği verildi; gerisini self-play öğreniyor.

## Bilinen sınırlar

- MatrAIx anketi henüz gerçek personalarla koşulmadı (geliştirme ortamında LLM anahtarı ve
  Hugging Face erişimi yoktu). Görev ve `persona_strategy.json` biçimi MatrAIx'in örnek
  görevinden kopyalandı; MatrAIx içinde denenmesi gerekir.
- Anket "ne yapardın?" diye sorar; insanların söylediği ile acil durumda yaptığı farklı olabilir.
  LLM personaları ise insandan daha uyumlu ve tutarlı olma eğilimindedir.
- Tek bir salon geometrisi ve 200 kişi; yoğunluk 1 m'lik hücrelerle ölçülür (kaba).
- Ağ küçük (MLP) ve eğitim kısa; sonuçlar bir kavram kanıtıdır, optimum değildir.
- Otomatik test yok (geliştirme oturumunda bilinçli olarak yazılmadı).
