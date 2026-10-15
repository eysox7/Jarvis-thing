// MatrAIx köprüsü: senaryoyu MatrAIx anket görevine çevirme ve sonuçları geri okuma.
//
// Görev biçimi MatrAIx-Persona-8B deposundaki application/tasks/example-survey_product-feedback
// örneğini izler (task.toml, instruction.md, input/context.md, input/questionnaire.yaml,
// persona_strategy.json, reporting.json, tests/). Çıktı: /app/output/survey_result.json
//   { answers: [{ questionId, value, rationale?, confidence? }], trajectory: [...] }

import { describeConfig } from './scenarios.js';
import { LIKERT_P } from './llm.js';

const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

// configs: [{ id, label, config }]  — sorulacak tasarımlar (başlangıç, en iyi statik, AlphaZero…)
export function buildTask(scn, configs) {
  const name = `survey_decision-${slug(scn.id || scn.title)}`;
  const scale = scn.domain === 'marketing'
    ? 'How likely are you to start using it? (1 = definitely not, 5 = definitely yes)'
    : 'How much would you support it? (1 = strongly oppose, 5 = strongly support)';
  const questions = configs.map((c, k) => ({
    id: `c${k}`,
    prompt: `Version ${String.fromCharCode(65 + k)} (see "Versions" in the brief). ${scale}`,
    type: 'likert', construct: `support_${c.id}`, required: true, minValue: 1, maxValue: 5,
  }));
  for (const l of scn.levers) {
    questions.push({
      id: `pref_${l.id}`, prompt: `Which option for "${l.label}" would you prefer?`,
      type: 'single_choice', construct: `preference_${l.id}`, required: true,
      options: l.options.map((o) => ({ id: `${l.id}__${o.id}`, label: o.label })),
    });
  }
  const versions = configs.map((c, k) => `### Version ${String.fromCharCode(65 + k)}\n${describeConfig(scn, c.config)}`).join('\n\n');
  const files = {
    'task.toml': `version = "1.0"
artifacts = [ "/app/output",]

[task]
name = "application/${name.replace('survey_', '')}"

[metadata]
difficulty = "easy"
type = "survey"
domain = "${scn.domain === 'marketing' ? 'consumer' : 'public-policy'}"
tags = [ "decision lab", "conjoint", "AlphaZero",]


[verifier]
timeout_sec = 120.0

[agent]
timeout_sec = 600.0

[environment]
definition = "application/shared-survey-form"
build_timeout_sec = 600.0
cpus = 1
memory_mb = 2048
storage_mb = 10240
gpus = 0
`,
    'instruction.md': `# ${scn.title}

Read the brief, then answer every question as **you** honestly would — including
indifference, distrust or opposition. There are no right answers.

## How to answer

- Read the brief before you start.
- Answer every required question.
- For multiple-choice, use the listed option ids.
- For rating scales, use a whole number in the given range.
- Add a short reason and your confidence (0–1) where you can.
`,
    'input/context.md': `# ${scn.title}

${scn.summary}

## Versions

${versions}
`,
    'input/questionnaire.yaml': toYaml({
      schemaVersion: '1.0', id: `${slug(scn.id || scn.title)}_v1`, title: scn.title,
      description: 'Decision Lab: reaction to alternative designs.', questions,
    }),
    'persona_strategy.json': JSON.stringify({
      schemaVersion: '1.0', sources: [], dimensionFilters: {},
      sampling: { mode: 'stratified', fields: [], allocation: 'proportional', sampleSize: 50 },
    }, null, 2) + '\n',
    'reporting.json': '{\n  "schemaVersion": "1.0",\n  "contextRules": []\n}\n',
    'versions.json': JSON.stringify({ scenario: scn.id, configs }, null, 2) + '\n',
    'tests/test.sh': `#!/usr/bin/env bash
set -euo pipefail
TESTS_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
VERIFIER_DIR="\${HARBOR_VERIFIER_DIR:-/logs/verifier}"
mkdir -p "$VERIFIER_DIR"
if python3 "\${TESTS_DIR}/test_state.py"; then echo 1 > "\${VERIFIER_DIR}/reward.txt"; else echo 0 > "\${VERIFIER_DIR}/reward.txt"; exit 1; fi
`,
    'tests/test_state.py': `import json, os, sys
from pathlib import Path
out = Path(os.environ.get("HARBOR_OUTPUT_DIR") or os.environ.get("MATRIX_OUTPUT_DIR") or "/app/output") / "survey_result.json"
need = ${JSON.stringify(questions.map((q) => q.id))}
if not out.exists():
    sys.exit(f"{out} yok")
ans = {str(a.get("questionId")): a.get("value") for a in json.loads(out.read_text()).get("answers", [])}
missing = [q for q in need if q not in ans]
sys.exit(f"eksik: {missing}" if missing else 0)
`,
  };
  return { name, files };
}

// Tek dosyalık kurulum betiği: MatrAIx deposunun kökünde çalıştırılınca görevi oluşturur.
export function taskScript({ name, files }) {
  const parts = [`#!/usr/bin/env bash
# Karar Laboratuvarı → MatrAIx anket görevi. MatrAIx-Persona-8B deposunun kökünde çalıştır:
#   bash ${name}.sh
# Sonra:
#   uv run python application/scripts/generate_application_job.py --task application/tasks/${name} --execution-mode auto
set -euo pipefail
D="application/tasks/${name}"
mkdir -p "$D/input" "$D/tests"
`];
  for (const [path, body] of Object.entries(files)) {
    const tag = 'DECISION_LAB_EOF';
    parts.push(`cat > "$D/${path}" <<'${tag}'\n${body.endsWith('\n') ? body : body + '\n'}${tag}\n`);
  }
  parts.push(`chmod +x "$D/tests/test.sh"\necho "Görev hazır: $D"\n`);
  return parts.join('\n');
}

// Yüklenen MatrAIx sonuç klasörü → [{ personaId|null, answers: {qid: value} }]
// files: [{ path, text }]. Persona kimliği aynı deneme klasöründeki yapılandırma dosyalarından bulunur.
export function readResults(files) {
  const byDir = new Map();
  for (const f of files) {
    const dir = f.path.split('/').slice(0, -1).join('/');
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(f);
  }
  const out = [];
  for (const f of files) {
    if (!f.path.endsWith('survey_result.json')) continue;
    let answers;
    try { answers = Object.fromEntries((JSON.parse(f.text).answers || []).map((a) => [String(a.questionId), a.value])); } catch { continue; }
    // Deneme klasörü ve üst klasörlerinde persona izi ara.
    let personaId = null;
    const segs = f.path.split('/');
    for (let up = segs.length - 1; up > 0 && !personaId; up--) {
      for (const g of byDir.get(segs.slice(0, up).join('/')) || []) {
        if (g === f || g.text.length > 2e6) continue;
        const m = g.text.match(/persona_(\w+?)\.ya?ml/) || g.text.match(/"persona_id"\s*:\s*"([\w-]+)"/);
        if (m) { personaId = m[1]; break; }
      }
    }
    out.push({ personaId, answers });
  }
  return out;
}

export const likertP = (v) => LIKERT_P[Math.max(1, Math.min(5, Math.round(Number(v))))] ?? null;

// MatrAIx'in kullandığı sade YAML alt kümesi için küçük yazıcı.
function toYaml(v, ind = 0) {
  const pad = ' '.repeat(ind);
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? `${pad}- ${toYaml(x, ind + 2).trimStart()}` : `${pad}- ${scalar(x)}`)).join('\n');
  if (v && typeof v === 'object') {
    return Object.entries(v).map(([k, x]) => {
      if (x && typeof x === 'object') return `${pad}${k}:\n${toYaml(x, ind + 2)}`;
      return `${pad}${k}: ${scalar(x)}`;
    }).join('\n');
  }
  return pad + scalar(v);
}
const scalar = (x) => (typeof x === 'string' ? JSON.stringify(x) : String(x));
