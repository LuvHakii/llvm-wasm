#!/usr/bin/env bash
set -e

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
source $ROOT/emsdk/emsdk_env.sh >/dev/null 2>&1
export PATH="$REPO/node_modules/.bin:$PATH"

echo "[$(date +%T)] building slim sysroot for the compiler (headers + eh libs)"
SLIM=$ROOT/sysroot-clang
rm -rf $SLIM && mkdir -p $SLIM/include $SLIM/lib
find $SYSROOT/include -maxdepth 1 -type f -name '*.h' -exec cp {} $SLIM/include/ \;
cp -r $SYSROOT/include/wasm32-wasip1 $SLIM/include/
rm -rf $SLIM/include/wasm32-wasip1/noeh
mkdir -p $SLIM/include/wasm32-wasip1/eh/c++/v1/bits $SLIM/include/c++/v1/bits
cp $REPO/scripts/bits-stdc++.h $SLIM/include/wasm32-wasip1/eh/c++/v1/bits/stdc++.h
cp $REPO/scripts/bits-stdc++.h $SLIM/include/c++/v1/bits/stdc++.h
mkdir -p $SLIM/lib/wasm32-wasip1
cp $SYSROOT/lib/wasm32-wasip1/*.a $SYSROOT/lib/wasm32-wasip1/*.o $SLIM/lib/wasm32-wasip1/ 2>/dev/null || true
cp -r $SYSROOT/lib/wasm32-wasip1/eh $SLIM/lib/wasm32-wasip1/
RT=$ROOT/libclang_rt-$WASI_SDK_VER+m/wasm32-unknown-wasi/libclang_rt.builtins.a
if [ ! -f "$RT" ]; then
  curl -sL -o $ROOT/libclang_rt.tar.gz https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-$WASI_SDK_MAJOR/libclang_rt-$WASI_SDK_VER+m.tar.gz
  tar xf $ROOT/libclang_rt.tar.gz -C $ROOT
fi
cp $RT $SLIM/lib/wasm32-wasip1/
echo "  slim compiler sysroot: $(du -sh $SLIM | cut -f1)"

echo "[$(date +%T)] reconfiguring stage2 for merged clang+lld multicall (no ASYNCIFY)"
emcmake cmake "${COMMON_CMAKE[@]}" -B $BUILD \
  -DLLVM_TOOL_LLVM_DRIVER_BUILD=ON \
  -DLLVM_DISTRIBUTION_COMPONENTS="clang;lld" \
  -DCMAKE_CXX_FLAGS="-Dwait4=__syscall_wait4" \
  -DLLVM_ENABLE_THREADS=OFF \
  -DCMAKE_EXE_LINKER_FLAGS="-s ENVIRONMENT=worker -s NO_INVOKE_RUN -s EXIT_RUNTIME \
-s INITIAL_MEMORY=256MB -s ALLOW_MEMORY_GROWTH -s MAXIMUM_MEMORY=1GB -s STACK_SIZE=1MB \
-s EXPORTED_RUNTIME_METHODS=FS,callMain -s MODULARIZE -s EXPORT_ES6 -s WASM_BIGINT \
-s EXPORTED_FUNCTIONS=_main \
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
