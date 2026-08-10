#!/usr/bin/env bash
set -e

ROOT=${ROOT:-$HOME/llvm-build}
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SYSROOT=$ROOT/wasi-sysroot
CXX=${CXX_FOR_PCH:-$ROOT/wasi-sdk/bin/clang++}
OUT=$REPO/dist/pch
STDS=${STDS:-"c++11 c++14 c++17 c++20 c++23"}

mkdir -p $OUT
mkdir -p $SYSROOT/include/c++/v1/bits
cp $REPO/scripts/bits-stdc++.h $SYSROOT/include/c++/v1/bits/stdc++.h

printf '%-8s %14s %14s %8s\n' STD RAW GZIP GEN
for STD in $STDS; do
  S=$(date +%s%N)
  $CXX -x c++-header --target=wasm32-wasip1 --sysroot=$SYSROOT \
    -fwasm-exceptions -O0 -std=$STD \
    $SYSROOT/include/c++/v1/bits/stdc++.h -o $OUT/stdc++-$STD.pch
  MS=$(( ($(date +%s%N)-S)/1000000 ))
  gzip -9 -c $OUT/stdc++-$STD.pch > $OUT/stdc++-$STD.pch.gz
  rm $OUT/stdc++-$STD.pch
  printf '%-8s %14s %14s %6sms\n' "$STD" "-" "$(stat -c%s $OUT/stdc++-$STD.pch.gz)" "$MS"
done
echo "PCHs in $OUT (raw removed; only .gz shipped)"
du -sh $OUT
