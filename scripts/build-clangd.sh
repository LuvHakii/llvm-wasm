#!/usr/bin/env bash
set -e

LLVM_VER=21.1.0
LLVM_VER_MAJOR=21
ROOT=${ROOT:-$HOME/llvm-build}
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
JOBS=${JOBS:-8}

SRC=$ROOT/llvm-project
SYSROOT=$ROOT/wasi-sysroot
NATIVE=$ROOT/stage1
BUILD=$ROOT/stage2

source $ROOT/emsdk/emsdk_env.sh >/dev/null 2>&1

echo "[$(date +%T)] applying wait_stdin.patch"
cd $SRC
if [ ! -f .patched-wait-stdin ]; then
  git apply $REPO/patches/wait_stdin.patch && touch .patched-wait-stdin
else
  echo "  already applied"
fi

COMMON=(
  -G Ninja -S $SRC/llvm
  -DCMAKE_CXX_FLAGS="-pthread -Dwait4=__syscall_wait4"
  -DCMAKE_BUILD_TYPE=MinSizeRel
  -DLLVM_TARGET_ARCH=wasm32-emscripten
  -DLLVM_DEFAULT_TARGET_TRIPLE=wasm32-wasi
  -DLLVM_TARGETS_TO_BUILD=WebAssembly
  -DLLVM_ENABLE_PROJECTS="clang;clang-tools-extra;lld"
  -DLLVM_TABLEGEN=$NATIVE/bin/llvm-tblgen
  -DCLANG_TABLEGEN=$NATIVE/bin/clang-tblgen
  -DLLVM_BUILD_STATIC=ON
  -DLLVM_INCLUDE_EXAMPLES=OFF
  -DLLVM_INCLUDE_TESTS=OFF
  -DLLVM_INCLUDE_BENCHMARKS=OFF
  -DLLVM_ENABLE_BACKTRACES=OFF
  -DLLVM_ENABLE_UNWIND_TABLES=OFF
  -DLLVM_ENABLE_CRASH_OVERRIDES=OFF
  -DCLANG_ENABLE_STATIC_ANALYZER=OFF
  -DLLVM_ENABLE_TERMINFO=OFF
  -DLLVM_ENABLE_PIC=OFF
  -DLLVM_ENABLE_ZLIB=OFF
  -DCLANG_ENABLE_ARCMT=OFF
  -DLLVM_PARALLEL_LINK_JOBS=1
  -DCLANGD_TIDY_CHECKS=OFF
  -DCLANGD_BUILD_XPC=OFF
  -DCLANGD_ENABLE_REMOTE=OFF
)

echo "[$(date +%T)] pass 1: configure (headers only)"
emcmake cmake "${COMMON[@]}" -B $BUILD \
  -DCMAKE_EXE_LINKER_FLAGS="-pthread -s ENVIRONMENT=worker -s NO_INVOKE_RUN"

echo "[$(date +%T)] pass 1: build clang-resource-headers"
cmake --build $BUILD --target clang-resource-headers -j $JOBS

echo "[$(date +%T)] seeding sysroot with compiler headers + bits/stdc++.h"
cp -r $BUILD/lib/clang/$LLVM_VER_MAJOR/include/* $SYSROOT/include/
mkdir -p $SYSROOT/include/c++/v1/bits
cp $REPO/scripts/bits-stdc++.h $SYSROOT/include/c++/v1/bits/stdc++.h

echo "[$(date +%T)] building slim sysroot (drop unused triples and the noeh variant)"
SLIM=$ROOT/sysroot-slim
rm -rf $SLIM && mkdir -p $SLIM/include
find $SYSROOT/include -maxdepth 1 -type f -name '*.h' -exec cp {} $SLIM/include/ \;
cp -r $SYSROOT/include/wasm32-wasi $SLIM/include/
rm -rf $SLIM/include/wasm32-wasi/noeh
mkdir -p $SLIM/include/wasm32-wasi/eh/c++/v1/bits
cp $REPO/scripts/bits-stdc++.h $SLIM/include/wasm32-wasi/eh/c++/v1/bits/stdc++.h
mkdir -p $SLIM/include/c++/v1/bits
cp $REPO/scripts/bits-stdc++.h $SLIM/include/c++/v1/bits/stdc++.h
echo "  slim sysroot: $(du -sh $SLIM/include | cut -f1) (was $(du -sh $SYSROOT/include | cut -f1))"

echo "[$(date +%T)] pass 2: configure (real link flags)"
emcmake cmake "${COMMON[@]}" -B $BUILD \
  -DCMAKE_EXE_LINKER_FLAGS="-pthread -s ENVIRONMENT=worker -s NO_INVOKE_RUN -s EXIT_RUNTIME \
-s INITIAL_MEMORY=2GB -s ALLOW_MEMORY_GROWTH -s MAXIMUM_MEMORY=4GB -s STACK_SIZE=256kB \
-s EXPORTED_RUNTIME_METHODS=FS,callMain -s MODULARIZE -s EXPORT_ES6 -s WASM_BIGINT \
-s ASYNCIFY -s PTHREAD_POOL_SIZE='Math.max(navigator.hardwareConcurrency, 8)' \
--embed-file=$SLIM/include@/usr/include"

echo "[$(date +%T)] pass 2: build clangd (-j$JOBS)"
cmake --build $BUILD --target clangd -j $JOBS

mkdir -p $REPO/dist
cp $BUILD/bin/clangd* $REPO/dist/ 2>/dev/null || true
echo "[$(date +%T)] CLANGD BUILD DONE"
ls -la $REPO/dist/
du -sh $BUILD
df -h / | tail -1
