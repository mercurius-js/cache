#! /bin/bash

echo '==============================='
echo '= Gateway Mode (10ms TTL)     ='
echo '==============================='
npx concurrently --raw -k \
  "node ./bench/gateway-service-1.js" \
  "node ./bench/gateway-service-2.js" \
  "npx wait-on tcp:3001 tcp:3002 && node ./bench/gateway.js 10" \
  "npx wait-on tcp:3000 && node ./bench/gateway-bench.js"

echo '==============================='
echo '= Gateway Mode (1000ms TTL)   ='
echo '==============================='
npx concurrently --raw -k \
  "node ./bench/gateway-service-1.js" \
  "node ./bench/gateway-service-2.js" \
  "npx wait-on tcp:3001 tcp:3002 && node ./bench/gateway.js 1000" \
  "npx wait-on tcp:3000 && node ./bench/gateway-bench.js"

echo '==============================='
echo '= Gateway Mode (10000ms TTL)   ='
echo '==============================='
npx concurrently --raw -k \
  "node ./bench/gateway-service-1.js" \
  "node ./bench/gateway-service-2.js" \
  "npx wait-on tcp:3001 tcp:3002 && node ./bench/gateway.js 10000" \
  "npx wait-on tcp:3000 && node ./bench/gateway-bench.js"

echo '==============================='
echo '= Gateway Mode (not cache)    ='
echo '==============================='
npx concurrently --raw -k \
  "node ./bench/gateway-service-1.js" \
  "node ./bench/gateway-service-2.js" \
  "npx wait-on tcp:3001 tcp:3002 && node ./bench/gateway.js" \
  "npx wait-on tcp:3000 && node ./bench/gateway-bench.js"
