# llvm-wasm

Builds the in-browser C++ toolchain used by `apps/playground` in [omni](../omni):
`clangd` (LSP) and `clang`/`lld` (compile + link), compiled to WebAssembly with
Emscripten, plus precompiled headers.

Artifacts are published as tagged GitHub Releases. omni consumes them via
`apps/playground/scripts/fetch-cpp-toolchain.ts` against a pinned tag — it never
builds LLVM itself.

## Pinned versions

| component | version | why |
|---|---|---|
| LLVM | `llvmorg-21.1.0` | matches `guyutongxue/clangd-in-browser`, the only working prior art for clangd-in-browser |
| Emscripten | 4.0.22 | same |
| WASI SDK sysroot | **33** | newer than upstream's 29; ships prebuilt `eh` libc++ so exceptions work |

## Layout

Transient state lives entirely under `$ROOT` (default `~/llvm-build`), so cleanup
is one `rm -rf`. Override to build on a bigger disk or another machine.

```
$ROOT/llvm-project   shallow llvmorg-21.1.0 clone
$ROOT/emsdk          pinned Emscripten SDK
$ROOT/wasi-sysroot   WASI SDK 33 sysroot (patched with bits/stdc++.h)
$ROOT/stage1         native llvm-tblgen + clang-tblgen (~67 MB)
$ROOT/stage2         Emscripten cross build (the big one)
```

Never build under `/tmp` — it is tmpfs on the dev box, so a build there consumes RAM.

## Build

```bash
scripts/setup.sh             # sources, emsdk, wasi-sysroot, native tblgen
scripts/build-clangd.sh      # stage2: clangd
scripts/build-clang.sh       # clang + wasm-ld from the same tree
# PCHs: node scripts/browser-test/run.mjs ./dist "/pch.html?std=c%2B%2B20" (per std)
```

PCHs are generated **by the built `clang.wasm` itself** in Chromium — clang
validates a PCH against the exact compiler build, so host-generated PCHs
(e.g. from wasi-sdk's clang) are rejected at `-include-pch` time. CI
(`.github/workflows/build.yml`) runs the whole chain and gates releases on
the browser harnesses.

`JOBS` defaults to 8 rather than nproc, and `LLVM_PARALLEL_LINK_JOBS=1` is forced:
LLVM link steps are memory-hungry and the dev box has ~10 GB free.

Pass 1 of the clangd build only builds `clang-resource-headers` (seconds) rather
than all of clangd, which is what upstream does — the pass exists solely to
produce the compiler builtin headers that get seeded into the sysroot.

## Measured facts

Established empirically on 2026-08-10 with stock wasi-sdk 33 (clang 22.1.0),
before any LLVM build existed. PCH generation is a host-side cross-compile, so
these were obtainable cheaply.

### Precompiled headers are decisive

| program | no PCH | with PCH | speedup |
|---|---|---|---|
| `<bits/stdc++.h>` + vector/sort/cout | 3757 ms | 465 ms | **8.1x** |
| compile only (no link) | 3701 ms | 388 ms | **9.5x** |
| `<iostream>` hello world | 2242 ms | 217 ms | **10.3x** |

Output binaries are byte-identical with and without PCH — purely a front-end win.

| standard | PCH gzip | gen |
|---|---|---|
| c++11 | 9.91 MiB | 2.18s |
| c++14 | 10.40 MiB | 2.23s |
| c++17 | 12.13 MiB | 2.62s |
| c++20 | 16.11 MiB | 4.10s |
| c++23 | 18.30 MiB | 4.98s |

All under Cloudflare Pages' 25 MiB per-file cap. **Raw** c++20/c++23 exceed it, so
shipping `.gz` is mandatory. 66.9 MiB total across all five; a user fetches one.

### Header set

99 of 104 candidate headers compile, identically at c++11 through c++23 — libc++ 22
guards newer headers internally rather than omitting them, so **one shim serves every
standard**. Unavailable: `csignal`, `generator`, `spanstream`, `stacktrace`, `stdfloat`.

Trimming the shim is not worth it: base PCH overhead is 0.11 MiB, but `<vector>` alone
is 7.87 MiB and `<iostream>` 10.08 MiB. The ~10 MiB floor is libc++'s core templates.
All 72 headers beyond a minimal competitive-programming set total only 5 MiB.

### clangd, verified in headless Chromium

| metric | measured |
|---|---|
| module instantiate | 1.6 s |
| `initialize` | 25 ms |
| diagnostics | 25 ms, 0 errors on a `<bits/stdc++.h>` program |
| completion (warm) | 276 ms, 40 real `std::vector` members |
| preamble (cold, once) | 9.3 s, 24.5 MB |

`clangd.wasm` is 61.2 MiB raw / **14.7 MiB gzipped**, under Cloudflare Pages' 25 MiB
per-file cap.

**The sysroot dominates the binary.** wasi-sdk ships five target triples, each with
`eh` and `noeh` libc++ copies — 173 MB of headers. Keeping only `wasm32-wasi/eh`
cuts it to 25 MB and takes the wasm from 180.5 MiB to 61.2 MiB (gzip 31.6 → 14.7).
Dropping clang-tidy from clangd saved only a further ~2 MiB by comparison.

Node cannot host these builds: `ENVIRONMENT=worker` plus pthreads needs a Web
`Worker` global (`Worker is not defined`). All testing goes through
`node scripts/browser-test/run.mjs`, which serves `dist/` with COOP/COEP and drives
real Chromium.

Two things that fail *silently* if wrong:
- **Include paths.** libc++ is at `include/wasm32-wasi/eh/c++/v1`, not `include/c++/v1`.
  Get this wrong and clangd degrades to identifier-based completion with no error.
- **stdin chunking.** Feed discrete chunks each followed by a `null`, not a continuous
  byte stream. Streaming leaves clangd blocked with zero stdout.

### Runtime behaviour (verified under Node 24 `node:wasi`)

| feature | result |
|---|---|
| `throw` / `catch` | works |
| `std::filesystem` (write, `file_size`, `create_directory`, `directory_iterator`) | works, given a preopened dir |
| `std::mutex`, `std::atomic`, deferred `std::async` | work |
| `std::thread` + `join` | links, then **traps at runtime** |

### Compile + link + run, verified in headless Chromium

Full pipeline on `<bits/stdc++.h>` + `sort` + iostream + `throw`/`catch`:

| step | measured |
|---|---|
| clang compile (no PCH) | 5.6 s -> `main.o` 37 KB |
| wasm-ld link | 0.4 s -> `main.wasm` 3.7 MB |
| run under browser_wasi_shim | `1 3 4 5` / `caught: boom` |

Four things that were required and are not obvious:

1. **`wasm-ld --threads=1`.** lld is linked with `-pthread` but no
   `PTHREAD_POOL_SIZE`, so any attempt to spawn a thread finds an empty worker pool
   and **crashes the page** with no error - and only once lld gets far enough to
   write output, so an early error exit looks fine. `--threads=1` avoids thread
   creation entirely. If parallel linking ever matters (it does not: links are
   ~0.4s), add a pool at link time instead of just raising the flag.
2. **`-lclang_rt.builtins`.** Otherwise `undefined symbol: __multi3`. It is a separate
   wasi-sdk release asset (`libclang_rt-33.0+m.tar.gz`), not part of the sysroot tarball.
3. **`-mllvm -wasm-use-legacy-eh=false`.** Our clang 21 defaults to legacy EH while
   wasi-sdk 33's prebuilt libc++ uses exnref, so linking succeeds and then
   `WebAssembly.compile` rejects the result: *"module uses a mix of legacy and new
   exception handling instructions"*.
4. **clang and lld must not share a page/worker.** Instantiating both at once crashes
   Chromium regardless of `INITIAL_MEMORY`. Run them in separate workers.

Also note ninja will not relink when only the *contents* of an `--embed-file` directory
change - the path is unchanged, so the output looks up to date. Delete the binary to force it.

### Gotchas

- **`-lunwind` is required** with `-fwasm-exceptions`; it is not auto-linked.
  Without it: `undefined symbol: _Unwind_RaiseException`.
- **`-include-pch` still needs `-I`** for the shim directory — the source's textual
  `#include <bits/stdc++.h>` must resolve; it no-ops via `#pragma once`.
- Emscripten has no `fork`/`exec`, so clang cannot spawn `wasm-ld`. Solved without
  patching LLVM: run clang with `-###`, which prints the commands it *would* run,
  then invoke each via `callMain`. Verified to decompose into exactly two steps
  (`clang -cc1 …`, then `wasm-ld …`).

## Credits

`patches/wait_stdin.patch` and the CMake configuration derive from
[guyutongxue/clangd-in-browser](https://github.com/guyutongxue/clangd-in-browser) (MIT).
`scripts/upstream-build.sh` is kept verbatim as reference.
