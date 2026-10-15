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
  }

  train(ctx, {
    ...opts,
    onProgress: (p) => self.postMessage({ type: 'progress', ...p, series: Array.from(p.series) }),
  });
  self.postMessage({ type: 'done' });
};
