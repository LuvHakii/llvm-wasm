#!/usr/bin/env bash
set -e

ROOT=${ROOT:-$HOME/llvm-build}
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
JOBS=${JOBS:-8}

SRC=$ROOT/llvm-project
SYSROOT=$ROOT/wasi-sysroot
NATIVE=$ROOT/stage1
BUILD=$ROOT/stage2

source $ROOT/emsdk/emsdk_env.sh >/dev/null 2>&1

echo "[$(date +%T)] reconfiguring stage2 for clang+lld (no ASYNCIFY)"
emcmake cmake -G Ninja -S $SRC/llvm -B $BUILD \
  -DCMAKE_CXX_FLAGS="-pthread -Dwait4=__syscall_wait4" \
  -DCMAKE_BUILD_TYPE=MinSizeRel \
  -DLLVM_TARGET_ARCH=wasm32-emscripten \
  -DLLVM_DEFAULT_TARGET_TRIPLE=wasm32-wasi \
  -DLLVM_TARGETS_TO_BUILD=WebAssembly \
  -DLLVM_ENABLE_PROJECTS="clang;clang-tools-extra;lld" \
  -DLLVM_TABLEGEN=$NATIVE/bin/llvm-tblgen \
  -DCLANG_TABLEGEN=$NATIVE/bin/clang-tblgen \
  -DLLVM_BUILD_STATIC=ON \
  -DLLVM_TOOL_LLVM_DRIVER_BUILD=ON \
  -DLLVM_INCLUDE_EXAMPLES=OFF -DLLVM_INCLUDE_TESTS=OFF -DLLVM_INCLUDE_BENCHMARKS=OFF \
  -DLLVM_ENABLE_BACKTRACES=OFF -DLLVM_ENABLE_UNWIND_TABLES=OFF \
  -DLLVM_ENABLE_CRASH_OVERRIDES=OFF -DCLANG_ENABLE_STATIC_ANALYZER=OFF \
  -DLLVM_ENABLE_TERMINFO=OFF -DLLVM_ENABLE_PIC=OFF -DLLVM_ENABLE_ZLIB=OFF \
  -DCLANG_ENABLE_ARCMT=OFF -DLLVM_PARALLEL_LINK_JOBS=1 \
  -DCMAKE_EXE_LINKER_FLAGS="-pthread -s ENVIRONMENT=worker -s NO_INVOKE_RUN -s EXIT_RUNTIME \
-s INITIAL_MEMORY=512MB -s ALLOW_MEMORY_GROWTH -s MAXIMUM_MEMORY=4GB -s STACK_SIZE=1MB \
-s EXPORTED_RUNTIME_METHODS=FS,callMain -s MODULARIZE -s EXPORT_ES6 -s WASM_BIGINT \
--embed-file=$SYSROOT@/sysroot"

echo "[$(date +%T)] building llvm driver (clang + wasm-ld) -j$JOBS"
cmake --build $BUILD --target llvm-driver -j $JOBS

mkdir -p $REPO/dist
cp $BUILD/bin/llvm* $REPO/dist/ 2>/dev/null || true
echo "[$(date +%T)] CLANG BUILD DONE"
ls -la $REPO/dist/
du -sh $BUILD
df -h / | tail -1
