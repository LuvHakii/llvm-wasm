import {$} from "bun";
import {cpSync, existsSync, mkdirSync, readFileSync, rmSync} from "node:fs";
import {BASE_CMAKE, emenv, extractTar, JOBS, LTO_FLAGS, NATIVE, REPO, ROOT} from "./common.ts";

const env = await emenv();
const build = `${ROOT}/stage-x86-asm`;
const linker = [
	"-s ENVIRONMENT=worker", "-s NO_INVOKE_RUN", "-s EXIT_RUNTIME",
	"-s INITIAL_MEMORY=64MB", "-s ALLOW_MEMORY_GROWTH", "-s MAXIMUM_MEMORY=1GB", "-s STACK_SIZE=1MB",
	"-s EXPORTED_RUNTIME_METHODS=FS,callMain", "-s MODULARIZE", "-s EXPORT_ES6",
	"-s INCOMING_MODULE_JS_API=wasmBinary,instantiateWasm,print,printErr,noInitialRun,mainScriptUrlOrBlob",
	"-s EXPORTED_FUNCTIONS=_main", "--emit-tsd=clang-x86-asm.d.ts", LTO_FLAGS,
].join(" ");
const flags = [
	...BASE_CMAKE, "-S", `${ROOT}/x86-asm-src/llvm`, "-B", build,
	"-DCMAKE_CXX_FLAGS=-Dwait4=__syscall_wait4",
	"-DLLVM_ENABLE_PROJECTS=clang", "-DLLVM_TARGETS_TO_BUILD=X86",
	"-DLLVM_DEFAULT_TARGET_TRIPLE=x86_64-unknown-linux-gnu",
	"-DLLVM_ENABLE_THREADS=OFF",
	`-DLLVM_TABLEGEN=${NATIVE}/bin/llvm-tblgen`, `-DCLANG_TABLEGEN=${NATIVE}/bin/clang-tblgen`,
	"-DLLVM_EXTERNAL_PROJECTS=x86-asm", `-DLLVM_EXTERNAL_X86_ASM_SOURCE_DIR=${REPO}/x86-asm`,
	`-DCMAKE_EXE_LINKER_FLAGS=${linker}`,
];
await $`emcmake cmake ${flags}`.env(env);
await $`cmake --build ${build} --target clang-x86-asm -j ${JOBS}`.env(env);
const dist = `${REPO}/dist-x86-asm`;
mkdirSync(dist, {recursive: true});
for (const file of ["clang-x86-asm.js", "clang-x86-asm.wasm", "clang-x86-asm.d.ts"]) cpSync(`${build}/bin/${file}`, `${dist}/${file}`);

const sysroot = `${ROOT}/x86-asm-sysroot`;
const prefix = `${sysroot}/x86-asm`;
rmSync(sysroot, {recursive: true, force: true});
const libcxx = `${ROOT}/x86-asm-libcxx-headers`;
const hflags = [
	"-DLLVM_ENABLE_RUNTIMES=libcxx", "-DLLVM_ENABLE_PER_TARGET_RUNTIME_DIR=OFF",
	"-DLIBCXX_CXX_ABI=none", "-DLIBCXX_HAS_MUSL_LIBC=ON",
	"-DLIBCXX_INCLUDE_TESTS=OFF", "-DLIBCXX_INCLUDE_BENCHMARKS=OFF",
	"-DLIBCXX_INSTALL_LIBRARY=OFF", "-DLIBCXX_INSTALL_MODULES=OFF",
	`-DCMAKE_INSTALL_PREFIX=${prefix}`,
];
await $`cmake -S ${ROOT}/x86-asm-src/runtimes -B ${libcxx} -G Ninja ${hflags}`;
await $`cmake --build ${libcxx} --target install-cxx-headers -j ${JOBS}`;

const musl = `${ROOT}/musl-1.2.5`;
if (!existsSync(musl)) await extractTar("https://musl.libc.org/releases/musl-1.2.5.tar.gz", ROOT);
await $`./configure --target=x86_64-linux-musl --prefix=${prefix} CC=cc`.cwd(musl);
await $`make install-headers`.cwd(musl);
mkdirSync(`${prefix}/include/c++/v1/bits`, {recursive: true});
cpSync(`${REPO}/sysroot/bits-stdc++.h`, `${prefix}/include/c++/v1/bits/stdc++.h`);

const res = `${prefix}/clang/include`;
mkdirSync(res, {recursive: true});
for (const [, body] of readFileSync(`${ROOT}/x86-asm-src/clang/lib/Headers/CMakeLists.txt`, "utf8").matchAll(/^set\((?:core|x86)_files([^)]*)\)/gm)) {
	for (const line of body.split("\n").slice(1)) {
		const header = line.trim().split(/\s+/)[0];
		if (header && !header.startsWith("#")) cpSync(`${ROOT}/x86-asm-src/clang/lib/Headers/${header}`, `${res}/${header}`);
	}
}
mkdirSync(`${prefix}/licenses`, {recursive: true});
for (const project of ["libcxx", "clang"]) cpSync(`${ROOT}/x86-asm-src/${project}/LICENSE.TXT`, `${prefix}/licenses/${project}.txt`);
cpSync(`${musl}/COPYRIGHT`, `${prefix}/licenses/musl.txt`);
await $`tar -chf ${dist}/clang-x86-asm.headers.tar -C ${sysroot} x86-asm`;
