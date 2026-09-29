import {$} from "bun";
import {cpSync, existsSync, mkdirSync, rmSync} from "node:fs";
import {BUILD, COMMON_CMAKE, JOBS, REPO, ROOT, SYSROOT, WASI_SDK_MAJOR, WASI_SDK_VER, emenv, extractTar} from "./common.ts";

const env = await emenv();

const SLIM = `${ROOT}/sysroot-clang`;
const INC = `${SLIM}/include/wasm32-wasip1`;
const LIB = `${SLIM}/lib/wasm32-wasip1`;
rmSync(SLIM, {recursive: true, force: true});
mkdirSync(`${SLIM}/include`, {recursive: true});
mkdirSync(LIB, {recursive: true});
for (const f of new Bun.Glob("*.h").scanSync(`${SYSROOT}/include`)) cpSync(`${SYSROOT}/include/${f}`, `${SLIM}/include/${f}`);
cpSync(`${SYSROOT}/include/wasm32-wasip1`, INC, {recursive: true, dereference: true});
rmSync(`${INC}/noeh`, {recursive: true, force: true});
await $`patch -p1 -d ${SLIM} < ${REPO}/sysroot/tty.patch`;
for (const dir of [`${INC}/eh/c++/v1/bits`, `${SLIM}/include/c++/v1/bits`]) {
	mkdirSync(dir, {recursive: true});
	cpSync(`${REPO}/sysroot/bits-stdc++.h`, `${dir}/stdc++.h`);
}

const libs = `${SYSROOT}/lib/wasm32-wasip1`;
for (const f of new Bun.Glob("*.{a,o}").scanSync(libs)) cpSync(`${libs}/${f}`, `${LIB}/${f}`);
cpSync(`${libs}/eh`, `${LIB}/eh`, {recursive: true, dereference: true});

const emclang = `${ROOT}/emsdk/upstream/bin`;
await $`${emclang}/clang --target=wasm32-wasip1 --sysroot=${SLIM} -O2 -c ${REPO}/sysroot/tty.c -o ${ROOT}/tty.o`;
await $`${emclang}/llvm-ar rcs ${LIB}/libtty.a ${ROOT}/tty.o`;

const RT = `${ROOT}/libclang_rt-${WASI_SDK_VER}+m/wasm32-unknown-wasi/libclang_rt.builtins.a`;
if (!existsSync(RT)) await extractTar(`https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${WASI_SDK_MAJOR}/libclang_rt-${WASI_SDK_VER}+m.tar.gz`, ROOT);
cpSync(RT, `${LIB}/libclang_rt.builtins.a`);

const linker = [
	"-s ENVIRONMENT=worker", "-s NO_INVOKE_RUN", "-s EXIT_RUNTIME",
	"-s INITIAL_MEMORY=256MB", "-s ALLOW_MEMORY_GROWTH", "-s MAXIMUM_MEMORY=1GB", "-s STACK_SIZE=1MB",
	"-s EXPORTED_RUNTIME_METHODS=FS,callMain", "-s MODULARIZE", "-s EXPORT_ES6", "-s WASM_BIGINT",
	"-s EXPORTED_FUNCTIONS=_main",
	"--emit-tsd=llvm.d.ts",
	`--embed-file=${SLIM}/include@/sysroot/include`,
	`--embed-file=${SLIM}/lib@/sysroot/lib`,
].join(" ");

const extra = [
	"-DLLVM_TOOL_LLVM_DRIVER_BUILD=ON",
	"-DLLVM_DISTRIBUTION_COMPONENTS=clang;lld",
	"-DCMAKE_CXX_FLAGS=-Dwait4=__syscall_wait4",
	"-DLLVM_ENABLE_THREADS=OFF",
];
await $`emcmake cmake ${COMMON_CMAKE} ${extra} -B ${BUILD} -DCMAKE_EXE_LINKER_FLAGS=${linker}`.env(env);

const dist = `${REPO}/dist`;
for (const f of ["llvm.js", "llvm.wasm", "llvm.d.ts"]) rmSync(`${BUILD}/bin/${f}`, {force: true});
await $`cmake --build ${BUILD} --target llvm-driver -j ${JOBS}`.env(env);
mkdirSync(dist, {recursive: true});
for (const f of ["llvm.js", "llvm.wasm", "llvm.d.ts"]) cpSync(`${BUILD}/bin/${f}`, `${dist}/${f}`);
