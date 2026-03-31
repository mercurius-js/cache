#!/usr/bin/env bash
set -euo pipefail

pids=()

cleanup() {
  if ((${#pids[@]} > 0)); then
    kill "${pids[@]}" 2>/dev/null || true
    wait "${pids[@]}" 2>/dev/null || true
    pids=()
  fi
}

trap cleanup EXIT INT TERM

start_bg() {
  "$@" &
  pids+=("$!")
}

run_gateway_bench() {
  local label="$1"
  local ttl="${2-}"

  echo '==============================='
  echo "= ${label} ="
  echo '==============================='

  start_bg node ./bench/gateway-service-1.js
  start_bg node ./bench/gateway-service-2.js
  npx wait-on tcp:3001 tcp:3002

  if [[ -n "${ttl}" ]]; then
    start_bg node ./bench/gateway.js "${ttl}"
  else
    start_bg node ./bench/gateway.js
  fi

  npx wait-on tcp:3000
  node ./bench/gateway-bench.js
  cleanup
  echo
}

run_custom_key_bench() {
  local label="$1"
  local query_index="$2"

  echo '==============================='
  echo "= ${label} ="
  echo '==============================='

  start_bg node ./bench/custom-key.js
  npx wait-on tcp:3000
  QUERY="${query_index}" node ./bench/custom-key-bench.js
  cleanup
  echo
}

run_gateway_bench 'Gateway Mode (not cache)    ' ''
run_gateway_bench 'Gateway Mode (0s TTL)       ' '0'
run_gateway_bench 'Gateway Mode (1s TTL)       ' '1'
run_gateway_bench 'Gateway Mode (10s TTL)      ' '10'

echo '*******************************'
echo

run_custom_key_bench 'Default Key Serialization   ' '0'
run_custom_key_bench 'Custom Key Serialization    ' '1'
