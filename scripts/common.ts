import {$} from "bun";
import {homedir} from "node:os";
import {resolve} from "node:path";

export const LLVM_VER = "23.1.2";
export const EMSDK_VER = "6.0.10";
export const WASI_SDK_MAJOR = "34";
export const WASI_SDK_VER = `${WASI_SDK_MAJOR}.0`;

export const ROOT = process.env.ROOT ?? `${homedir()}/llvm-build`;
export const JOBS = process.env.JOBS ?? "8";
export const REPO = resolve(import.meta.dir, "..");

export const SRC = `${ROOT}/llvm-project`;
export const SYSROOT = `${ROOT}/wasi-sysroot`;
export const NATIVE = `${ROOT}/stage1`;
export const BUILD = `${ROOT}/stage2`;
// ThinLTO codegen cache, outside BUILD so CI can persist it. Content-addressed: keyed on bitcode + codegen options, so a
// link-flag-only change hits, an -O/-D change misses. Both links share it, size-capped for the Actions cache.
// prune_after=0s: expiry uses atime, which a hit never bumps, so time pruning could drop live entries. Size is the only limit.
export const LTO_FLAGS = `-Wl,--thinlto-cache-dir=${ROOT}/lto.cache -Wl,--thinlto-cache-policy=cache_size_bytes=3g:prune_after=0s`;

export const COMMON_CMAKE = [
	"-G", "Ninja", "-S", `${SRC}/llvm`,
	"-DCMAKE_CXX_FLAGS=-pthread -Dwait4=__syscall_wait4",
	"-DCMAKE_BUILD_TYPE=MinSizeRel",
	"-DLLVM_TARGET_ARCH=wasm32-emscripten",
	"-DLLVM_DEFAULT_TARGET_TRIPLE=wasm32-wasip1",
	"-DLLVM_TARGETS_TO_BUILD=WebAssembly",
	"-DLLVM_ENABLE_PROJECTS=clang;clang-tools-extra;lld",
	`-DLLVM_TABLEGEN=${NATIVE}/bin/llvm-tblgen`,
	`-DCLANG_TABLEGEN=${NATIVE}/bin/clang-tblgen`,
	"-DLLVM_BUILD_STATIC=ON",
	"-DLLVM_INCLUDE_EXAMPLES=OFF",
	"-DLLVM_INCLUDE_TESTS=OFF",
	"-DLLVM_INCLUDE_BENCHMARKS=OFF",
	"-DLLVM_ENABLE_BACKTRACES=OFF",
	"-DLLVM_ENABLE_UNWIND_TABLES=OFF",
	"-DLLVM_ENABLE_CRASH_OVERRIDES=OFF",
	"-DCLANG_ENABLE_STATIC_ANALYZER=OFF",
	"-DLLVM_ENABLE_TERMINFO=OFF",
	"-DLLVM_ENABLE_PIC=OFF",
	"-DLLVM_ENABLE_ZLIB=OFF",
	"-DLLVM_PARALLEL_LINK_JOBS=1",
	"-DLLVM_ENABLE_LTO=Thin",
	...(Bun.which("ccache") ? ["-DCMAKE_C_COMPILER_LAUNCHER=ccache", "-DCMAKE_CXX_COMPILER_LAUNCHER=ccache"] : []),
];

export async function emenv() {
	const raw = await $`bash -c 'source ${ROOT}/emsdk/emsdk_env.sh >/dev/null 2>&1; env -0'`.text();
	const env: Record<string, string> = {};
	for (const line of raw.split("\0")) {
		const i = line.indexOf("=");
		if (i > 0) env[line.slice(0, i)] = line.slice(i + 1);
	}
	env.PATH = `${REPO}/node_modules/.bin:${env.PATH}`;
	// Fresh emsdk installs change mtimes, so the default compiler_check=mtime never hits in CI. Key the compiler by
	// the emscripten-releases commit that built it. ccache hashes sources, headers and flags itself.
	const tags = await Bun.file(`${ROOT}/emsdk/emscripten-releases-tags.json`).json();
	const rel = tags.releases[EMSDK_VER];
	if (!rel) throw new Error(`no emscripten-releases commit for ${EMSDK_VER}`);
	env.CCACHE_COMPILERCHECK = `string:emscripten-releases-${rel}`;
	// em++ is clang underneath, but ccache guesses "other" from the name
	env.CCACHE_COMPILERTYPE = "clang";
	env.CCACHE_BASEDIR = ROOT;
	env.CCACHE_MAXSIZE ??= "4G";
	return env;
}

export async function extractTar(url: string, dir: string) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${res.status} ${url}`);
	await new Bun.Archive(await res.bytes()).extract(dir);
}

export async function patch(file: string) {
	const p = `${REPO}/patches/${file}`;
	const applied = await $`git -C ${SRC} apply --reverse --check ${p}`.quiet().nothrow();
	if (applied.exitCode === 0) return;
	await $`git -C ${SRC} apply ${p}`;
	console.log(`patch ${file}`);
}

if (import.meta.main) {
	for (const [k, v] of Object.entries({LLVM_VER, EMSDK_VER, WASI_SDK_VER})) console.log(`${k}=${v}`);
}
