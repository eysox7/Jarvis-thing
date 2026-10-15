#!/usr/bin/env python3
"""Doğrulama döngüsü: AlphaZero'nun bulduğu planı MatrAIx personalarına geri sorar.

Simülatör, personaların anonslara ne kadar uyacağını kalibrasyondan *varsayar*. AlphaZero
bu varsayımlar altında en iyi planı bulur; ama plan, simülatörün açıklarını da sömürmüş
olabilir. Burada planın kendisi (gerçek anons cümleleri, gerçek sırasıyla) yeni bir anket
görevine çevrilir ve personaların söylediği uyum, simülatörün varsaydığıyla karşılaştırılır.

    # 1) Planı üret
    node cli.mjs plan --seed 1 --json plan.json [--params persona-params.json]

    # 2) MatrAIx görevi oluştur → MatrAIx deposunda application/tasks/ altına kopyala ve koş
    python3 export_plan.py task --plan plan.json --out tasks/survey_evacuation-plan-validation

    # 3) Sonuçları karşılaştır
    python3 export_plan.py check --plan plan.json --jobs /path/to/MatrAIx/jobs/<job> [--params persona-params.json]
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
BASE_TASK = HERE / "tasks" / "survey_evacuation-announcement-response"

EXIT_NAMES = ["main entrance (west)", "stage-side exit (east)", "south exit", "north exit"]
WORDING = {
    "calm": "Please make your way to the {exit}.",
    "urgent": "Evacuate now — use the {exit} immediately!",
    "reasoned": "The main entrance is congested. The {exit} is clear — please use it.",
}
LIKERT = {1: 0.05, 2: 0.25, 3: 0.5, 4: 0.75, 5: 0.95}
# Kalibrasyon verilmezse simülatörün varsayılan uyum oranları (personas.js ile aynı).
DEFAULT_COMPLIANCE = {"calm": 0.6, "urgent": 0.7, "reasoned": 0.75}
DECISION = 5  # env.js ile aynı


def announcements(plan: dict) -> list[dict]:
    """plan.json (cli.mjs plan --json) içindeki anonsları zaman sırasıyla çıkarır."""
    out = []
    for i, label in enumerate(plan.get("actions", [])):
        if not label.startswith("anons"):
            continue
        kind = label[label.index("(") + 1 : label.index(")")]
        exit_name = label.split("→", 1)[1].strip()
        idx = next((j for j, n in enumerate(["Ana giriş", "Sahne yanı", "Acil çıkış (güney)", "Acil çıkış (kuzey)"]) if n == exit_name), None)
        if idx is None:
            continue
        out.append({"t": i * DECISION, "kind": kind, "exit": idx, "text": WORDING[kind].format(exit=EXIT_NAMES[idx])})
    return out


def cmd_task(args) -> int:
    plan = json.loads(args.plan.read_text(encoding="utf-8"))
    anns = announcements(plan)
    if not anns:
        print("Planda anons yok; doğrulanacak bir şey yok.", file=sys.stderr)
        return 1
    out: Path = args.out
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(BASE_TASK, out)

    timeline = "\n".join(f"- **{a['t']} s after the alarm**, from the speaker next to the {EXIT_NAMES[a['exit']]}: “{a['text']}”" for a in anns)
    context = (BASE_TASK / "input" / "context.md").read_text(encoding="utf-8")
    context += f"""
## What you hear

You are standing near whichever speaker is closest to you. Below is everything the
staff announce; answer each question as if you are close enough to hear that one.

{timeline}
"""
    (out / "input" / "context.md").write_text(context, encoding="utf-8")

    questions = []
    for i, a in enumerate(anns):
        questions.append({
            "id": f"a{i}",
            "prompt": f"At {a['t']} s you hear: “{a['text']}” How likely are you to go to the {EXIT_NAMES[a['exit']]}?",
            "type": "likert", "construct": f"plan_compliance_{a['kind']}", "required": True,
            "minValue": 1, "maxValue": 5,
        })
    questions.append({
        "id": "confusing", "prompt": "Taken together, how confusing are these announcements?",
        "type": "likert", "construct": "plan_confusion", "required": True, "minValue": 1, "maxValue": 5,
    })
    questions.append({
        "id": "safe", "prompt": "Taken together, how safe would these announcements make you feel?",
        "type": "likert", "construct": "plan_safety", "required": True, "minValue": 1, "maxValue": 5,
    })
    q = {
        "schemaVersion": "1.0", "id": "evacuation_plan_validation_v1",
        "title": "Evacuation Plan Validation",
        "description": "Persona reactions to an AlphaZero-generated evacuation announcement plan.",
        "questions": questions,
    }
    (out / "input" / "questionnaire.yaml").write_text(yaml.safe_dump(q, allow_unicode=True, sort_keys=False), encoding="utf-8")

    toml = (out / "task.toml").read_text(encoding="utf-8")
    toml = toml.replace('application/evacuation-announcement-response', 'application/evacuation-plan-validation')
    (out / "task.toml").write_text(toml, encoding="utf-8")
    (out / "plan.json").write_text(json.dumps({"seed": plan.get("seed"), "announcements": anns}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(anns)} anonsluk doğrulama görevi → {out}")
    return 0


def assumed_compliance(params: Path | None) -> dict[str, float]:
    if not params:
        return dict(DEFAULT_COMPLIANCE)
    data = json.loads(params.read_text(encoding="utf-8"))
    rows = [p for p in data["personas"] if p.get("behavior")]
    if not rows:
        return dict(DEFAULT_COMPLIANCE)
    tot = sum(p.get("weight", 1) for p in rows)
    return {k: sum(p["behavior"]["compliance"][k] * p.get("weight", 1) for p in rows) / tot for k in DEFAULT_COMPLIANCE}


def cmd_check(args) -> int:
    plan = json.loads(args.plan.read_text(encoding="utf-8"))
    anns = announcements(plan)
    assumed = assumed_compliance(args.params)
    stated: dict[str, list[float]] = {f"a{i}": [] for i in range(len(anns))}
    extra: dict[str, list[int]] = {"confusing": [], "safe": []}
    for f in sorted(args.jobs.rglob("survey_result.json")):
        try:
            ans = {str(a["questionId"]): a["value"] for a in json.loads(f.read_text(encoding="utf-8")).get("answers", [])}
        except (KeyError, json.JSONDecodeError):
            continue
        for k in stated:
            if k in ans:
                stated[k].append(LIKERT[max(1, min(5, int(ans[k])))])
        for k in extra:
            if k in ans:
                extra[k].append(int(ans[k]))

    n = max((len(v) for v in stated.values()), default=0)
    if n == 0:
        print("Hiç cevap bulunamadı.", file=sys.stderr)
        return 1
    print(f"{n} persona cevabı\n")
    print(f"{'t':>4}  {'ton':<9} {'varsayılan':>10} {'beyan':>7} {'fark':>6}  anons")
    worst = 0.0
    for i, a in enumerate(anns):
        vals = stated[f"a{i}"]
        if not vals:
            continue
        s = sum(vals) / len(vals)
        gap = s - assumed[a["kind"]]
        worst = min(worst, gap)
        flag = "  ⚠ simülatör iyimser" if gap < -0.2 else ""
        print(f"{a['t']:>4}  {a['kind']:<9} {assumed[a['kind']]:>10.2f} {s:>7.2f} {gap:>+6.2f}  {a['text']}{flag}")
    for k, label in (("confusing", "kafa karıştırıcılık"), ("safe", "güven hissi")):
        if extra[k]:
            print(f"\nOrtalama {label} (1-5): {sum(extra[k]) / len(extra[k]):.2f}")
    if worst < -0.2:
        print("\nSonuç: Personalar plana simülatörün varsaydığından belirgin şekilde az uyuyor."
              "\nBu cevapları calibrate.py ile kalibrasyona ekleyip yeniden eğitmek gerekir.")
    else:
        print("\nSonuç: Personaların beyan ettiği uyum, simülatörün varsayımıyla tutarlı.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("task", help="plan.json → MatrAIx doğrulama anketi görevi")
    t.add_argument("--plan", type=Path, required=True)
    t.add_argument("--out", type=Path, default=HERE / "tasks" / "survey_evacuation-plan-validation")
    c = sub.add_parser("check", help="doğrulama anketi sonuçlarını simülatör varsayımıyla karşılaştır")
    c.add_argument("--plan", type=Path, required=True)
    c.add_argument("--jobs", type=Path, required=True)
    c.add_argument("--params", type=Path)
    args = ap.parse_args()
    return cmd_task(args) if args.cmd == "task" else cmd_check(args)


if __name__ == "__main__":
    sys.exit(main())
