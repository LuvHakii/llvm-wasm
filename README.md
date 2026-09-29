# llvm-wasm

## Versions

| component | version |
|---|---|
| LLVM | `llvmorg-23.1.2` |
| Emscripten | 6.0.10 |
| WASI SDK sysroot | 34 |

## Layout

```
scripts/             build pipeline (Bun TS): setup, clangd, clang multicall, PCHs + gate
sysroot/             additions to include.tar / lib.tar: bits/stdc++.h, tty.patch, tty.c
patches/             LLVM source patches
test/                clangd LSP gate in Chromium
```

```
$ROOT                default ~/llvm-build, override for a bigger disk. never /tmp, tmpfs eats RAM
$ROOT/llvm-project   shallow llvmorg-23.1.2 clone
$ROOT/emsdk          pinned Emscripten SDK
$ROOT/wasi-sysroot   WASI SDK 34 sysroot, pristine
$ROOT/stage1         native llvm-tblgen + clang-tblgen (~67 MB)
$ROOT/stage2         Emscripten cross build
```

## Build

```bash
bun scripts/setup.ts            # sources, emsdk, wasi-sysroot, native tblgen
bun scripts/build-clangd.ts     # clangd
bun scripts/build-clang.ts      # llvm multicall (clang, wasm-ld, clang-format), include.tar, lib.tar
bun scripts/gen-pch.ts ./dist   # five stdc++ PCHs + compile/link/run gate, no browser
bun test/clangd.ts ./dist       # clangd LSP gate, Chromium
```

## Measured

2026-08-10, stock wasi-sdk 33 (clang 22.1.0), before our own LLVM build existed.

| program | with PCH |
|---|---|
| `<bits/stdc++.h>` + vector/sort/cout | 8.1x faster |
| compile only (no link) | 9.5x faster |
| `<iostream>` hello world | 10.3x faster |

Binaries byte-identical either way. Front-end only.

Sizes stay absolute below, since what matters is the Cloudflare Pages 25 MiB
per-file cap, not a ratio.

| standard | PCH gzip | gen, vs c++11 |
|---|---|---|
| c++11 | 9.91 MiB | 1.0x |
| c++14 | 10.40 MiB | 1.0x |
| c++17 | 12.13 MiB | 1.2x |
| c++20 | 16.11 MiB | 1.9x |
| c++23 | 18.30 MiB | 2.3x |

Raw c++20 and c++23 blow the cap, gzipped they fit. 66.9 MiB across all five,
a user fetches one.

99 of 104 candidate headers compile, identically at c++11 through c++23, since
libc++ 22 guards the newer ones internally. One shim, every standard. Missing:
`csignal`, `generator`, `spanstream`, `stacktrace`, `stdfloat`. Trimming the
shim is pointless: `<vector>` alone costs 70x the base overhead and `<iostream>`
90x, while all 72 headers past a competitive-programming set add only 5 MiB.

## Caveats

All live in the scripts or tests. Drop one, the build breaks without saying why.

- Embed only `wasm32-wasip1/eh`. wasi-sdk ships five triples, each with `eh` and
  `noeh` libc++. Dropping the rest cuts header mass 7x and `clangd.wasm` 3x,
  gzip 2.2x, landing at 14.7 MiB, under the cap. `CLANGD_TIDY_CHECKS=OFF` shaves
  another 3%.
- Sysroot layout matches clang's WASI defaults, so no `--sysroot` or `-isystem`:
  libc++ (eh variant) at `include/c++/v1`, clang's core + wasm builtin headers
  (40 of ~230, the rest is other arches' intrinsics) in `include/`, libs
  flat in `lib/wasm32-wasip1`. clang only adds the libc++ paths once it finds a
  `v1` under the generic `include/c++/`, so libc++ must live there, not per target.
- stdin chunking. Feed clangd discrete chunks, each followed by a `null`. A
  continuous stream leaves it blocked at zero stdout, also silent.
- clangd needs a real browser, the compiler does not. Node has no `Worker`, so
  `ENVIRONMENT=worker` dies at `Worker is not defined`. Under bun the whole
  compile + link + run passes headless from the multicall binary, both tools in
  one process, since neither has a pthread pool. clangd's 16-worker pool never
  comes up: bun drops the `Worker` `name` option, and patching that only moves
  the hang. So Chromium via Playwright, `dist/` under COOP/COEP.
- `wasm-ld --threads=1`. lld is linked `-pthread` with no `PTHREAD_POOL_SIZE`,
  so a thread spawn finds an empty pool and kills the page with no error, and
  only once lld is far enough to write output, so an early exit looks fine.
  Links are 0.4s, so if parallel ever matters, add a pool instead.
- `-lclang_rt.builtins`. Else `undefined symbol: __multi3`. Separate wasi-sdk
  asset (`libclang_rt-34.0.tar.gz`), not in the sysroot tarball.
- `-mllvm -wasm-use-legacy-eh=false`. Our clang defaults to legacy EH, wasi-sdk
  34 libc++ uses exnref. Link succeeds, then `WebAssembly.compile` refuses:
  *"module uses a mix of legacy and new exception handling instructions"*.
- `-lunwind` with `-fwasm-exceptions`, not auto-linked. Without it:
  `undefined symbol: _Unwind_RaiseException`.
- PCH must come from the `llvm.wasm` just built. clang validates a PCH against
  the compiler build, so host-generated ones die at `-include-pch`.
- `-include-pch` still needs the textual `#include <bits/stdc++.h>` to resolve,
  then it no-ops via `#pragma once`. The shim sits in `include/c++/v1/bits`.
- `-Xclang -fno-validate-pch` in every consumer. The host mounts
  the sysroot fresh per instance, new mtimes, so clang rejects any PCH built by
  another one: *"mtime changed"*. Skip the flag and every PCH is dead weight.
  `gen-pch.ts` compiles, links and runs a probe with each one before writing it.
- clang and lld never share a page or worker. Both at once crashed Chromium at
  any `INITIAL_MEMORY`. One multicall binary now, `gen-pch.ts` still gives
  each its own instance.
- Emscripten has no `fork`/`exec`, clang cannot spawn `wasm-ld`. No LLVM patch
  needed: run clang `-###`, it prints the commands it would run, then `callMain`
  each. Exactly two, `clang -cc1 ...` then `wasm-ld ...`.
- Sysroot ships as `include.tar` (headers, clangd + clang) and `lib.tar` (libs,
  wasm-ld), not inside the wasm. The host mounts them at `/` on each instance
  before `callMain`, e.g. nanotar `parseTar` then `FS.createDataFile(path, null,
  data, true, false, true)`. `canOwn` keeps files as views into the tar, outside
  linear memory, one copy shared by every instance. Not `--preload-file`: its
  index lives in each `.js` and it fetches by bare name, which hangs under bun.
- clang-format is in the multicall via `patches/clang-format-driver.patch`
  (`GENERATE_DRIVER`, `main` becomes `clang_format_main`). Run it as
  `thisProgram: '/usr/bin/clang-format'`.
- ThinLTO (`LLVM_ENABLE_LTO=Thin`) on both builds. `Release` (-O2) blows the size
  budget; ThinLTO keeps `-Os` and inlines and strips across libraries instead.
- clangd links mimalloc, the llvm multicall keeps dlmalloc. mimalloc's per-thread
  heaps remove dlmalloc's global lock, which clangd's thread pool contends on; it costs
  code and memory, and the single-threaded compiler has no contention to fix.
- `JOBS` is 8, not nproc, and `LLVM_PARALLEL_LINK_JOBS=1`. Link steps eat
  memory, dev box has ~10 GB free.
- Compiled programs get `std::thread` that links and then traps at runtime, and
  `std::filesystem` only with a preopened dir. `throw`/`catch`, `std::mutex`,
  `std::atomic` and deferred `std::async` all work.

- Terminal support. wasi-libc ships no `termios.h`. `build-clang.ts` applies
  `sysroot/tty.patch` (adds `termios.h`, `TCGETS`/`TCSETS`/`TIOCGWINSZ`
  and `struct winsize` in `sys/ioctl.h`) to the slim sysroot and
  adds `libtty.a` (`__wrap_ioctl`, from `sysroot/tty.c`). Link with `-ltty
  --wrap=ioctl`; the host must provide wasm imports `tty.tcgets`, `tty.tcsets` and
  `tty.winsize`. The wire layout is musl `struct termios`: `c_cc` at offset 17, 60
  bytes total. `gen-pch.ts` checks it.

## Credits

`patches/wait_stdin.patch` and CMake config from
[guyutongxue/clangd-in-browser](https://github.com/guyutongxue/clangd-in-browser)
(MIT).
