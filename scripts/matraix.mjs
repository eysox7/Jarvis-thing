#!/usr/bin/env node
// matrAIx komut satırı: tarayıcı olmadan PR koşusu.
//
//   GROQ_API_KEY=... node scripts/matraix.mjs \
//     --product "premium mikrolot karışımı kahve" \
//     --regions "Avrupa, ABD" --audience "genç profesyoneller" --count 15
//
// Anahtar yalnızca ortam değişkeninden okunur, hiçbir yere yazılmaz.
// Seçenekler: --provider (PRESETS anahtarı, varsayılan groq) --model --goal
//             --keyword-lang --report-lang --out <dosya.md> --json <dosya.json>

import { writeFileSync } from 'node:fs';
import { PRESETS, chat } from '../js/providers.js';
import { runMatrix } from '../js/matrix.js';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = argv[i + 1];
    out[key] = next && !next.startsWith('--') ? (i++, next) : true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const provider = args.provider || 'groq';
const preset = PRESETS[provider];
if (!preset) { console.error(`Bilinmeyen sağlayıcı: ${provider}`); process.exit(2); }

const envName = (args.keyEnv || `${provider.toUpperCase()}_API_KEY`);
const apiKey = process.env[envName] || process.env.MATRAIX_API_KEY || '';
if (!apiKey && !preset.noKey) {
  console.error(`API anahtarı yok. ${envName} veya MATRAIX_API_KEY ortam değişkenini tanımla.`);
  process.exit(2);
}
if (!args.product) { console.error('--product zorunlu'); process.exit(2); }

const profile = {
  name: preset.label, provider, kind: preset.kind, baseUrl: preset.baseUrl,
  apiKey, model: args.model || preset.models[0],
};

const llm = async ({ system, messages, temperature }) =>
  (await chat(profile, { system, messages, temperature, maxTokens: 4096 })).text;

const t0 = Date.now();
const run = await runMatrix({
  product: args.product, regions: args.regions, audience: args.audience, goal: args.goal,
  count: args.count, keywordLang: args.keywordLang, reportLang: args.reportLang,
}, {
  llm,
  onStage: (stage, info) => console.error(`[matrAIx] ${stage}: ${info.label}`),
});

console.error(`[matrAIx] ${run.combos.length} kombinasyon, ${run.calls} model çağrısı, ${((Date.now() - t0) / 1000).toFixed(1)} sn · ${profile.model}`);
if (args.out) writeFileSync(args.out, run.report + '\n');
if (args.json) writeFileSync(args.json, JSON.stringify(run, null, 2) + '\n');
console.log(run.report);
