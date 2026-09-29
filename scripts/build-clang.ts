import {$} from "bun";
import {cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync} from "node:fs";
import {basename} from "node:path";
import {
	BUILD, COMMON_CMAKE, JOBS, LLVM_VER, REPO, ROOT, SRC, SYSROOT, WASI_SDK_MAJOR, WASI_SDK_VER,
	emenv, extractTar,
} from "./common.ts";

const env = await emenv();

const linker = [
	"-s ENVIRONMENT=worker", "-s NO_INVOKE_RUN", "-s EXIT_RUNTIME",
	"-s INITIAL_MEMORY=64MB", "-s ALLOW_MEMORY_GROWTH", "-s MAXIMUM_MEMORY=1GB", "-s STACK_SIZE=1MB",
	"-s EXPORTED_RUNTIME_METHODS=FS,callMain", "-s MODULARIZE", "-s EXPORT_ES6",
	"-s EXPORTED_FUNCTIONS=_main",
	"--emit-tsd=llvm.d.ts",
].join(" ");

const extra = [
	"-DLLVM_TOOL_LLVM_DRIVER_BUILD=ON",
	"-DLLVM_DISTRIBUTION_COMPONENTS=clang;lld",
	"-DCMAKE_CXX_FLAGS=-Dwait4=__syscall_wait4",
	"-DLLVM_ENABLE_THREADS=OFF",
];
await $`emcmake cmake ${COMMON_CMAKE} ${extra} -B ${BUILD} -DCMAKE_EXE_LINKER_FLAGS=${linker}`.env(env);

await $`cmake --build ${BUILD} --target llvm-driver core-resource-headers webassembly-resource-headers -j ${JOBS}`.env(env);
const dist = `${REPO}/dist`;
mkdirSync(dist, {recursive: true});
for (const f of ["llvm.js", "llvm.wasm", "llvm.d.ts"]) cpSync(`${BUILD}/bin/${f}`, `${dist}/${f}`);

const SLIM = `${ROOT}/sysroot-clang`;
const INC = `${SLIM}/include/wasm32-wasip1`;
const LIB = `${SLIM}/lib/wasm32-wasip1`;
rmSync(SLIM, {recursive: true, force: true});
mkdirSync(`${SLIM}/include`, {recursive: true});
mkdirSync(LIB, {recursive: true});

for (const [, body] of readFileSync(`${SRC}/clang/lib/Headers/CMakeLists.txt`, "utf8").matchAll(/^set\((?:core|webassembly)_files([^)]*)\)/gm)) {
	for (const line of body.split("\n").slice(1)) {
		const h = line.trim().split(/\s+/)[0];
		if (h) cpSync(`${BUILD}/lib/clang/${LLVM_VER.split(".")[0]}/include/${h}`, `${SLIM}/include/${h}`);
	}
}

cpSync(`${SYSROOT}/include/wasm32-wasip1`, INC, {recursive: true, dereference: true});
renameSync(`${INC}/eh/c++`, `${SLIM}/include/c++`);
for (const p of [`${INC}/eh`, `${INC}/noeh`, `${SLIM}/include/c++/v1/__cxx03`]) rmSync(p, {recursive: true, force: true});
await $`patch -p1 -d ${SLIM} < ${REPO}/sysroot/tty.patch`;
await $`patch -p1 -d ${SLIM} < ${REPO}/sysroot/sigaction.patch`;
mkdirSync(`${SLIM}/include/c++/v1/bits`, {recursive: true});
cpSync(`${REPO}/sysroot/bits-stdc++.h`, `${SLIM}/include/c++/v1/bits/stdc++.h`);

const libs = `${SYSROOT}/lib/wasm32-wasip1`;
for (const pattern of ["*.{a,o}", "eh/*.a"]) {
	for (const f of new Bun.Glob(pattern).scanSync(libs)) cpSync(`${libs}/${f}`, `${LIB}/${basename(f)}`);
}

const emclang = `${ROOT}/emsdk/upstream/bin`;
await $`${emclang}/clang --target=wasm32-wasip1 --sysroot=${SLIM} -O2 -c ${REPO}/sysroot/tty.c -o ${ROOT}/tty.o`;
await $`${emclang}/llvm-ar rcs ${LIB}/libtty.a ${ROOT}/tty.o`;

const RT = `${ROOT}/libclang_rt-${WASI_SDK_VER}/wasm32-unknown-wasi/libclang_rt.builtins.a`;
if (!existsSync(RT)) await extractTar(`https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${WASI_SDK_MAJOR}/libclang_rt-${WASI_SDK_VER}.tar.gz`, ROOT);
cpSync(RT, `${LIB}/libclang_rt.builtins.a`);

await $`tar -chf ${dist}/include.tar -C ${SLIM} include`;
await $`tar -chf ${dist}/lib.tar -C ${SLIM} lib`;
