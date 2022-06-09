#! /bin/bash

echo '==============================='
echo '= Gateway Mode (not cache)    ='
echo '==============================='
npx concurrently --raw -k \
  "node ./bench/gateway-service-1.js" \
  "node ./bench/gateway-service-2.js" \
  "npx wait-on tcp:3001 tcp:3002 && node ./bench/gateway.js" \
  "npx wait-on tcp:3000 && node ./bench/gateway-bench.js"

echo

echo '==============================='
echo '= Gateway Mode (0s TTL)       ='
echo '==============================='
npx concurrently --raw -k \
  "node ./bench/gateway-service-1.js" \
  "node ./bench/gateway-service-2.js" \
  "npx wait-on tcp:3001 tcp:3002 && node ./bench/gateway.js 0" \
  "npx wait-on tcp:3000 && node ./bench/gateway-bench.js"

echo

echo '==============================='
echo '= Gateway Mode (1s TTL)       ='
echo '==============================='
npx concurrently --raw -k \
  "node ./bench/gateway-service-1.js" \
  "node ./bench/gateway-service-2.js" \
  "npx wait-on tcp:3001 tcp:3002 && node ./bench/gateway.js 1" \
  "npx wait-on tcp:3000 && node ./bench/gateway-bench.js"

echo

echo '==============================='
echo '= Gateway Mode (10s TTL)      ='
echo '==============================='
npx concurrently --raw -k \
  "node ./bench/gateway-service-1.js" \
  "node ./bench/gateway-service-2.js" \
  "npx wait-on tcp:3001 tcp:3002 && node ./bench/gateway.js 10" \
  "npx wait-on tcp:3000 && node ./bench/gateway-bench.js"

echo
echo '*******************************'
echo

echo

echo '==============================='
echo '= Default Key Serialization   ='
echo '==============================='
npx concurrently --raw -k \
  "node ./bench/custom-key.js" \
  "npx wait-on tcp:3000 && QUERY=0 node ./bench/custom-key-bench.js"

echo

echo '==============================='
echo '= Custom Key Serialization   ='
echo '==============================='
npx concurrently --raw -k \
  "node ./bench/custom-key.js" \
  "npx wait-on tcp:3000 && QUERY=1 node ./bench/custom-key-bench.js"
