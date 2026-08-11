# llvm-wasm

## Versions

| component | version |
|---|---|
| LLVM | `llvmorg-22.1.8` |
| Emscripten | 4.0.22 |
| WASI SDK sysroot | 33 |

## Layout

```
$ROOT                default ~/llvm-build, override for a bigger disk. never /tmp, tmpfs eats RAM
$ROOT/llvm-project   shallow llvmorg-22.1.8 clone
$ROOT/emsdk          pinned Emscripten SDK
$ROOT/wasi-sysroot   WASI SDK 33 sysroot (patched with bits/stdc++.h)
$ROOT/stage1         native llvm-tblgen + clang-tblgen (~67 MB)
$ROOT/stage2         Emscripten cross build
```

## Build

```bash
scripts/setup.sh                # sources, emsdk, wasi-sysroot, native tblgen
scripts/build-clangd.sh         # pass 1 builtin headers, pass 2 clangd
scripts/build-clang.sh          # llvm multicall (clang + wasm-ld), same tree
bun scripts/gen-pch.ts ./dist   # five stdc++ PCHs, no browser
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

- Embed only `wasm32-wasi/eh`. wasi-sdk ships five triples, each with `eh` and
  `noeh` libc++. Dropping the rest cuts header mass 7x and `clangd.wasm` 3x,
  gzip 2.2x, landing at 14.7 MiB, under the cap. `CLANGD_TIDY_CHECKS=OFF` shaves
  another 3%.
- Include paths. libc++ is at `include/wasm32-wasi/eh/c++/v1`, not
  `include/c++/v1`. Wrong path, clangd drops to identifier-based completion,
  silently.
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
  asset (`libclang_rt-33.0+m.tar.gz`), not in the sysroot tarball.
- `-mllvm -wasm-use-legacy-eh=false`. Our clang defaults to legacy EH, wasi-sdk
  33 libc++ uses exnref. Link succeeds, then `WebAssembly.compile` refuses:
  *"module uses a mix of legacy and new exception handling instructions"*.
- `-lunwind` with `-fwasm-exceptions`, not auto-linked. Without it:
  `undefined symbol: _Unwind_RaiseException`.
- PCH must come from the `llvm.wasm` just built. clang validates a PCH against
  the compiler build, so host-generated ones die at `-include-pch`.
- `-include-pch` still needs `-I` for the shim dir. The textual
  `#include <bits/stdc++.h>` has to resolve, then no-ops via `#pragma once`.
- `-Xclang -fno-validate-pch` in every consumer. `--embed-file`
  restamps the sysroot mtime per instance, so clang rejects any PCH built by
  another one: *"mtime changed"*. Skip the flag and every PCH is dead weight.
  `gen-pch.ts` probe-compiles each one before writing it.
- clang and lld never share a page or worker. Both at once crashed Chromium at
  any `INITIAL_MEMORY`. One multicall binary now, tests still load compile and
  link separately.
- Emscripten has no `fork`/`exec`, clang cannot spawn `wasm-ld`. No LLVM patch
  needed: run clang `-###`, it prints the commands it would run, then `callMain`
  each. Exactly two, `clang -cc1 ...` then `wasm-ld ...`.
- ninja will not relink when only the *contents* of an `--embed-file` dir
  change. Path unchanged, output looks current. Delete the binary to force it.
- `JOBS` is 8, not nproc, and `LLVM_PARALLEL_LINK_JOBS=1`. Link steps eat
  memory, dev box has ~10 GB free.
- Compiled programs get `std::thread` that links and then traps at runtime, and
  `std::filesystem` only with a preopened dir. `throw`/`catch`, `std::mutex`,
  `std::atomic` and deferred `std::async` all work.

## Credits

`patches/wait_stdin.patch` and CMake config from
[guyutongxue/clangd-in-browser](https://github.com/guyutongxue/clangd-in-browser)
(MIT).
