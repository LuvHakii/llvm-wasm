#!/usr/bin/env bash
set -e

LLVM_VER=21.1.0
EMSDK_VER=4.0.22
WASI_SDK_MAJOR=33
WASI_SDK_VER=33.0
ROOT=${ROOT:-$HOME/llvm-build}
JOBS=${JOBS:-8}

mkdir -p $ROOT

if [ ! -d $ROOT/llvm-project ]; then
  echo "[$(date +%T)] cloning llvm-project (shallow, llvmorg-$LLVM_VER)"
  git clone --depth 1 --branch llvmorg-$LLVM_VER --single-branch \
    https://github.com/llvm/llvm-project.git $ROOT/llvm-project
fi

if [ ! -d $ROOT/emsdk ]; then
  echo "[$(date +%T)] installing emsdk $EMSDK_VER"
  git clone --depth 1 https://github.com/emscripten-core/emsdk.git $ROOT/emsdk
  $ROOT/emsdk/emsdk install $EMSDK_VER
  $ROOT/emsdk/emsdk activate $EMSDK_VER
fi

if [ ! -d $ROOT/wasi-sysroot ]; then
  echo "[$(date +%T)] fetching wasi-sysroot $WASI_SDK_VER"
  curl -sL https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-$WASI_SDK_MAJOR/wasi-sysroot-$WASI_SDK_VER.tar.gz | tar xz -C $ROOT
  mv $ROOT/wasi-sysroot-$WASI_SDK_VER $ROOT/wasi-sysroot
fi

if [ ! -f $ROOT/stage1/bin/llvm-tblgen ] || [ ! -f $ROOT/stage1/bin/clang-tblgen ]; then
  echo "[$(date +%T)] stage1: native tblgen"
  cmake -S $ROOT/llvm-project/llvm -B $ROOT/stage1 -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DLLVM_ENABLE_PROJECTS="clang" \
    -DLLVM_TARGETS_TO_BUILD=WebAssembly \
    -DLLVM_INCLUDE_TESTS=OFF -DLLVM_INCLUDE_EXAMPLES=OFF \
    -DLLVM_INCLUDE_BENCHMARKS=OFF -DLLVM_INCLUDE_DOCS=OFF \
    -DLLVM_ENABLE_ZLIB=OFF -DLLVM_ENABLE_LIBXML2=OFF -DLLVM_ENABLE_TERMINFO=OFF
  ninja -C $ROOT/stage1 -j$JOBS llvm-tblgen clang-tblgen
fi

echo "[$(date +%T)] SETUP DONE"
du -sh $ROOT/* 2>/dev/null
