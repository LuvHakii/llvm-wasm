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
export PATH="$REPO/node_modules/.bin:$PATH"

echo "[$(date +%T)] building slim sysroot for the compiler (headers + eh libs)"
SLIM=$ROOT/sysroot-clang
rm -rf $SLIM && mkdir -p $SLIM/include $SLIM/lib
find $SYSROOT/include -maxdepth 1 -type f -name '*.h' -exec cp {} $SLIM/include/ \;
cp -r $SYSROOT/include/wasm32-wasi $SLIM/include/
rm -rf $SLIM/include/wasm32-wasi/noeh
mkdir -p $SLIM/include/wasm32-wasi/eh/c++/v1/bits $SLIM/include/c++/v1/bits
cp $REPO/scripts/bits-stdc++.h $SLIM/include/wasm32-wasi/eh/c++/v1/bits/stdc++.h
cp $REPO/scripts/bits-stdc++.h $SLIM/include/c++/v1/bits/stdc++.h
mkdir -p $SLIM/lib/wasm32-wasi
cp $SYSROOT/lib/wasm32-wasi/*.a $SYSROOT/lib/wasm32-wasi/*.o $SLIM/lib/wasm32-wasi/ 2>/dev/null || true
cp -r $SYSROOT/lib/wasm32-wasi/eh $SLIM/lib/wasm32-wasi/
RT=$ROOT/libclang_rt-33.0+m/wasm32-unknown-wasi/libclang_rt.builtins.a
if [ ! -f "$RT" ]; then
  curl -sL -o $ROOT/libclang_rt.tar.gz https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-33/libclang_rt-33.0+m.tar.gz
  tar xf $ROOT/libclang_rt.tar.gz -C $ROOT
fi
cp $RT $SLIM/lib/wasm32-wasi/
echo "  slim compiler sysroot: $(du -sh $SLIM | cut -f1)"

echo "[$(date +%T)] reconfiguring stage2 for merged clang+lld multicall (no ASYNCIFY)"
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
  -DLLVM_INCLUDE_EXAMPLES=OFF -DLLVM_INCLUDE_TESTS=OFF -DLLVM_INCLUDE_BENCHMARKS=OFF \
  -DLLVM_ENABLE_BACKTRACES=OFF -DLLVM_ENABLE_UNWIND_TABLES=OFF \
  -DLLVM_ENABLE_CRASH_OVERRIDES=OFF -DCLANG_ENABLE_STATIC_ANALYZER=OFF \
  -DLLVM_ENABLE_TERMINFO=OFF -DLLVM_ENABLE_PIC=OFF -DLLVM_ENABLE_ZLIB=OFF \
  -DCLANG_ENABLE_ARCMT=OFF -DLLVM_PARALLEL_LINK_JOBS=1 \
  -DLLVM_TOOL_LLVM_DRIVER_BUILD=ON \
  -DLLVM_DISTRIBUTION_COMPONENTS="clang;lld" \
  -DCMAKE_EXE_LINKER_FLAGS="-pthread -s ENVIRONMENT=worker -s NO_INVOKE_RUN -s EXIT_RUNTIME \
-s INITIAL_MEMORY=1GB -s ALLOW_MEMORY_GROWTH -s MAXIMUM_MEMORY=4GB -s STACK_SIZE=1MB \
-s EXPORTED_RUNTIME_METHODS=FS,callMain -s MODULARIZE -s EXPORT_ES6 -s WASM_BIGINT \
-s EXPORTED_FUNCTIONS=_main,__emscripten_thread_crashed \
--emit-tsd=llvm.d.ts \
--embed-file=$SLIM/include@/sysroot/include \
--embed-file=$SLIM/lib@/sysroot/lib"

echo "[$(date +%T)] building llvm multicall -j$JOBS"
rm -f $BUILD/bin/llvm.js $BUILD/bin/llvm.wasm $BUILD/bin/llvm.d.ts
cmake --build $BUILD --target llvm-driver -j $JOBS
mkdir -p $REPO/dist
cp $BUILD/bin/llvm.js $BUILD/bin/llvm.wasm $BUILD/bin/llvm.d.ts $REPO/dist/
echo "[$(date +%T)] MERGED LLVM BUILD DONE"
ls -la $REPO/dist/
du -sh $BUILD
df -h / | tail -1
