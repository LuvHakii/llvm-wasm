import {$} from "bun";
import {homedir} from "node:os";
import {resolve} from "node:path";

export const LLVM_VER = "22.1.8";
export const EMSDK_VER = "4.0.22";
export const WASI_SDK_MAJOR = "33";
export const WASI_SDK_VER = `${WASI_SDK_MAJOR}.0`;

export const ROOT = process.env.ROOT ?? `${homedir()}/llvm-build`;
export const JOBS = process.env.JOBS ?? "8";
export const REPO = resolve(import.meta.dir, "..");

export const SRC = `${ROOT}/llvm-project`;
export const SYSROOT = `${ROOT}/wasi-sysroot`;
export const NATIVE = `${ROOT}/stage1`;
export const BUILD = `${ROOT}/stage2`;

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
	"-DCLANG_ENABLE_ARCMT=OFF",
	"-DLLVM_PARALLEL_LINK_JOBS=1",
];

export async function emenv() {
	const raw = await $`bash -c 'source ${ROOT}/emsdk/emsdk_env.sh >/dev/null 2>&1; env -0'`.text();
	const env: Record<string, string> = {};
	for (const line of raw.split("\0")) {
		const i = line.indexOf("=");
		if (i > 0) env[line.slice(0, i)] = line.slice(i + 1);
	}
	env.PATH = `${REPO}/node_modules/.bin:${env.PATH}`;
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
