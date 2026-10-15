#!/usr/bin/env python3
"""MatrAIx anket sonuçlarını tahliye simülatörünün persona parametrelerine çevirir.

Kullanım (MatrAIx deposunda görev koşulduktan sonra):

    python3 calibrate.py --jobs /path/to/MatrAIx/jobs/<job> \
        --personas /path/to/MatrAIx/persona/datasets/<dataset> \
        --out ../persona-params.json

    # Anket koşulmadan, sadece persona YAML boyutlarından (önsel eşleme JS tarafında):
    python3 calibrate.py --personas /path/to/persona/datasets/<dataset> --out ../persona-params.json

Sonra:  node cli.mjs train --params persona-params.json

Her persona simülasyonda kendi ağırlığıyla temsil edilir; her soru tek bir davranış
parametresine karşılık gelir (eşleme aşağıda, tek yerde).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml

LIKERT = {1: 0.05, 2: 0.25, 3: 0.5, 4: 0.75, 5: 0.95}

# Soru cevabı → parametre. Değerler simülatör birimlerindedir (saniye, olasılık, çarpan).
START_DELAY = {
    "q_start_leave_now": 0.5,
    "q_start_look_around": 3.0,
    "q_start_wait_crowd": 6.0,
    "q_start_wait_official": 10.0,
}
DEFAULT_EXIT = {  # (familiarity, herding tabanı)
    "q_default_way_in": (0.9, 0.2),
    "q_default_nearest_sign": (0.15, 0.2),
    "q_default_follow_crowd": (0.4, 0.7),
}
SWITCH_DELAY = {
    "q_switch_immediately": 0.5,
    "q_switch_see_exit": 2.0,
    "q_switch_see_others": 4.0,
}
URGENCY = {  # (panic, ek anons gecikmesi)
    "q_urgency_calm": (0.05, 0.0),
    "q_urgency_hurry": (0.35, 0.0),
    "q_urgency_push": (0.8, 0.0),
    "q_urgency_freeze": (0.15, 1.5),
}
PACE = {"q_pace_slower": 0.75, "q_pace_average": 1.0, "q_pace_faster": 1.15}
BASE_SPEED = 1.34  # m/s, ortalama yürüme hızı


def behavior_from_answers(ans: dict[str, object]) -> dict:
    def likert(qid: str) -> float:
        return LIKERT[max(1, min(5, int(ans[qid])))]

    fam, herd_base = DEFAULT_EXIT[str(ans["q_default_exit"])]
    panic, extra_delay = URGENCY[str(ans["q_urgency_effect"])]
    return {
        "speed": round(BASE_SPEED * PACE[str(ans["q_pace"])], 3),
        "behavior": {
            "delay": START_DELAY[str(ans["q_start"])],
            "annDelay": SWITCH_DELAY[str(ans["q_switch_speed"])] + extra_delay,
            "compliance": {
                "calm": likert("q_calm"),
                "urgent": likert("q_urgent"),
                "reasoned": likert("q_reasoned"),
            },
            "herding": round(0.5 * herd_base + 0.5 * (int(ans["q_herd"]) - 1) / 4, 3),
            "familiarity": fam,
            "panic": panic,
        },
    }


# ── MatrAIx çıktılarını okuma ────────────────────────────────────────────────
PERSONA_PATTERNS = [
    re.compile(r"persona_(\w+?)\.ya?ml"),
    re.compile(r'"?persona_id"?\s*[:=]\s*"?\'?([\w-]+)'),
]


def find_persona_id(trial_dir: Path, stop: Path) -> str | None:
    """Deneme (trial) klasöründeki yapılandırma dosyalarında persona kimliğini arar."""
    d = trial_dir
    while True:
        for f in sorted(d.glob("*")):
            if f.suffix not in {".json", ".yaml", ".yml", ".toml", ".txt"} or not f.is_file():
                continue
            if f.name == "survey_result.json" or f.stat().st_size > 2_000_000:
                continue
            text = f.read_text(encoding="utf-8", errors="ignore")
            for pat in PERSONA_PATTERNS:
                m = pat.search(text)
                if m:
                    return m.group(1)
        if d == stop or d.parent == d:
            return None
        d = d.parent


def load_personas(root: Path | None) -> dict[str, dict]:
    out: dict[str, dict] = {}
    if not root:
        return out
    for f in sorted(root.rglob("*.yaml")):
        try:
            doc = yaml.safe_load(f.read_text(encoding="utf-8"))
        except yaml.YAMLError:
            continue
        if isinstance(doc, dict) and "persona_id" in doc:
            out[str(doc["persona_id"])] = doc
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--jobs", type=Path, help="MatrAIx jobs/<job> klasörü (survey_result.json dosyaları)")
    ap.add_argument("--personas", type=Path, help="Persona YAML klasörü (boyutlar için)")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    yamls = load_personas(args.personas)
    personas: list[dict] = []
    skipped = 0

    if args.jobs:
        for result in sorted(args.jobs.rglob("survey_result.json")):
            try:
                payload = json.loads(result.read_text(encoding="utf-8"))
                ans = {str(a["questionId"]): a["value"] for a in payload.get("answers", [])}
                params = behavior_from_answers(ans)
            except (KeyError, ValueError, TypeError, json.JSONDecodeError) as e:
                print(f"atlandı: {result} ({e!r})", file=sys.stderr)
                skipped += 1
                continue
            pid = find_persona_id(result.parent, args.jobs) or result.parent.name
            entry = {"persona_id": pid, "weight": 1, **params, "source": "survey"}
            if pid in yamls:
                entry["dimensions"] = yamls[pid].get("dimensions", {})
            personas.append(entry)
    else:
        # Anket yok: boyutları aktar, davranışı JS tarafındaki önsel eşleme üretsin.
        for pid, doc in yamls.items():
            personas.append({"persona_id": pid, "weight": 1, "dimensions": doc.get("dimensions", {}), "source": "prior"})

    if not personas:
        print("Hiç persona bulunamadı. --jobs veya --personas yolunu kontrol et.", file=sys.stderr)
        return 1

    out = {
        "schemaVersion": "1.0",
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "matraix-survey" if args.jobs else "matraix-dimensions-prior",
        "task": "application/evacuation-announcement-response",
        "skipped": skipped,
        "personas": personas,
    }
    args.out.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(personas)} persona → {args.out}" + (f" ({skipped} atlandı)" if skipped else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
