#!/usr/bin/env bash
# N.E.X.U.S. test koşucusu.
#   ./tests/run.sh
# Gereksinim: playwright (yerel `npm i` ile veya global kurulu).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-8099}"

# playwright yerelde yoksa global kurulumu bağla.
# (NODE_PATH ES modüllerinde işe yaramaz, bu yüzden sembolik bağ kuruyoruz.)
if [ ! -d "$ROOT/node_modules/playwright" ]; then
  GLOBAL_PW="$(npm root -g)/playwright"
  if [ -d "$GLOBAL_PW" ]; then
    mkdir -p "$ROOT/node_modules"
    ln -sfn "$GLOBAL_PW" "$ROOT/node_modules/playwright"
    ln -sfn "$(npm root -g)/playwright-core" "$ROOT/node_modules/playwright-core" 2>/dev/null || true
  else
    echo "playwright bulunamadı. Kur:  npm install" >&2
    exit 1
  fi
fi

cd "$ROOT"
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 1

export BASE="http://127.0.0.1:$PORT"
fail=0
for t in tests/*.test.mjs; do
  echo ""
  echo "═══ $t ═══"
  node "$t" || fail=1
done

echo ""
[ $fail -eq 0 ] && echo "✔ HEPSİ GEÇTİ" || echo "✖ BAŞARISIZ TEST VAR"
exit $fail
