"""survey_result.json'ın bu görevin anketine uyduğunu doğrular.

Her soru cevaplanmış mı, seçmeli cevaplar listelenen kimliklerden mi, Likert
cevapları 1-5 arası tam sayı mı? Kalibrasyon (calibrate.py) bu garantilere dayanır.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import yaml

OUTPUT_DIR = Path(os.environ.get("HARBOR_OUTPUT_DIR") or os.environ.get("MATRIX_OUTPUT_DIR") or "/app/output")
RESULT_PATH = OUTPUT_DIR / "survey_result.json"
TASK_DIR = Path(__file__).resolve().parent.parent
QUESTIONNAIRE = Path(os.environ.get("MATRIX_INPUT_DIR", "/app/input")) / "questionnaire.yaml"
if not QUESTIONNAIRE.exists():
    QUESTIONNAIRE = TASK_DIR / "input" / "questionnaire.yaml"


def main() -> int:
    if not RESULT_PATH.exists():
        print(f"{RESULT_PATH} yok", file=sys.stderr)
        return 1
    payload = json.loads(RESULT_PATH.read_text(encoding="utf-8"))
    answers = {str(a.get("questionId")): a.get("value") for a in payload.get("answers") or [] if isinstance(a, dict)}
    questions = yaml.safe_load(QUESTIONNAIRE.read_text(encoding="utf-8"))["questions"]
    errors = []
    for q in questions:
        qid = q["id"]
        if qid not in answers:
            if q.get("required"):
                errors.append(f"{qid}: cevap yok")
            continue
        v = answers[qid]
        if q["type"] == "likert":
            try:
                iv = int(v)
            except (TypeError, ValueError):
                errors.append(f"{qid}: Likert tam sayı değil: {v!r}")
                continue
            if not (q["minValue"] <= iv <= q["maxValue"]):
                errors.append(f"{qid}: aralık dışı: {iv}")
        elif q["type"] == "single_choice":
            ids = {o["id"] for o in q["options"]}
            if str(v) not in ids:
                errors.append(f"{qid}: geçersiz seçenek: {v!r}")
    for e in errors:
        print(e, file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
