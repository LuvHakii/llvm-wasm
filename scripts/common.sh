#!/usr/bin/env bash
# Shared config. Sourced by setup.sh, build-clangd.sh, build-clang.sh.

LLVM_VER=22.1.8
LLVM_VER_MAJOR=${LLVM_VER%%.*}
EMSDK_VER=4.0.22
WASI_SDK_MAJOR=33
WASI_SDK_VER=$WASI_SDK_MAJOR.0

ROOT=${ROOT:-$HOME/llvm-build}
JOBS=${JOBS:-8}
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

SRC=$ROOT/llvm-project
SYSROOT=$ROOT/wasi-sysroot
NATIVE=$ROOT/stage1
BUILD=$ROOT/stage2

# Shared by both stage2 configures. Each build adds its own targets and its own
# CMAKE_EXE_LINKER_FLAGS, which is where they actually differ.
COMMON_CMAKE=(
  -G Ninja -S $SRC/llvm
  -DCMAKE_CXX_FLAGS="-pthread -Dwait4=__syscall_wait4"
  -DCMAKE_BUILD_TYPE=MinSizeRel
  -DLLVM_TARGET_ARCH=wasm32-emscripten
  -DLLVM_DEFAULT_TARGET_TRIPLE=wasm32-wasip1
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
)
