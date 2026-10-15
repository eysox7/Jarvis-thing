#!/usr/bin/env bash
# MatrAIx/Harbor doğrulayıcısı: survey_result.json anket şemasına uyuyor mu?
set -euo pipefail
TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERIFIER_DIR="${HARBOR_VERIFIER_DIR:-/logs/verifier}"
mkdir -p "$VERIFIER_DIR"
if python3 "${TESTS_DIR}/test_state.py"; then
  echo 1 > "${VERIFIER_DIR}/reward.txt"
else
  echo 0 > "${VERIFIER_DIR}/reward.txt"
  exit 1
fi
