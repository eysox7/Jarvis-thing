// AlphaZero eğitimini arayüzü kilitlemeden ayrı iş parçacığında koşturur.
// Durdurma: ana iş parçacığı worker.terminate() çağırır; son gönderilen en iyi plan geçerli kalır.
import { createContext, forecast } from './model.js';
import { train } from './az.js';

self.onmessage = ({ data }) => {
  const { scenario, personas, segmentDim, calibration, opts } = data;
  const ctx = createContext(scenario, personas, { segmentDim, calibration });

  // Kıyas: tüm statik tasarımları dene (kombinasyon sayısı makulse). AlphaZero bunu,
  // üstüne zamanlama ve tek seferlik eylemleri ekleyerek geçebilmeli.
  const combos = scenario.levers.reduce((m, l) => m * l.options.length, 1);
  let startConfig = null;
  if (combos <= 600) {
    let best = null;
    const rec = (i, cfg) => {
      if (i === scenario.levers.length) {
        const r = forecast(ctx, cfg);
        if (!best || r.total > best.total) best = { total: r.total, parts: r.parts, segs: r.segs, config: { ...cfg } };
        return;
      }
      for (const o of scenario.levers[i].options) { cfg[scenario.levers[i].id] = o.id; rec(i + 1, cfg); }
    };
    rec(0, {});
    self.postMessage({ type: 'static', combos, ...best });
    startConfig = best.config;
  } else {
    // Çok fazla kombinasyon: koordinat yükselişi (her seferinde bir kararı en iyi seçeneğe
    // çek, iyileşme bitene kadar tekrarla). Kesin en iyi değil ama iyi bir başlangıç.
    let cfg = Object.fromEntries(scenario.levers.map((l) => [l.id, l.initial ?? l.options[0].id]));
    let best = forecast(ctx, cfg);
    for (let pass = 0, improved = true; improved && pass < 10; pass++) {
      improved = false;
      for (const l of scenario.levers) for (const o of l.options) {
        if (o.id === cfg[l.id]) continue;
        const r = forecast(ctx, { ...cfg, [l.id]: o.id });
        if (r.total > best.total + 1e-9) { best = r; cfg = { ...cfg, [l.id]: o.id }; improved = true; }
      }
    }
    self.postMessage({ type: 'static', combos, approx: true, total: best.total, parts: best.parts, segs: best.segs, config: cfg });
    startConfig = cfg;
  }

  train(ctx, {
    ...opts,
    startConfig,
    onProgress: (p) => self.postMessage({ type: 'progress', ...p, series: Array.from(p.series) }),
  });
  self.postMessage({ type: 'done' });
};
