#!/usr/bin/env bash
set -euo pipefail

pid=''

cleanup() {
  if [[ -n "${pid}" ]]; then
    kill "${pid}" 2>/dev/null || true
    wait "${pid}" 2>/dev/null || true
    pid=''
  fi
}

trap cleanup EXIT INT TERM

run_bench() {
  local label="$1"
  local ttl="${2-}"

  echo '==============================='
  echo "= ${label} ="
  echo '==============================='

  if [[ -n "${ttl}" ]]; then
    node ./bench/single-server.js "${ttl}" &
  else
    node ./bench/single-server.js &
  fi
  pid="$!"

  npx wait-on tcp:3000
  node ./bench/single-server-bench.js
  cleanup
  echo
}

run_bench 'Single server (no cache) ' ''
run_bench 'Single server (ttl: 1)  ' '1'
run_bench 'Single server (ttl: 10) ' '10'
