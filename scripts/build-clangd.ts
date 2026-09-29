import {$} from "bun";
import {cpSync, mkdirSync, rmSync} from "node:fs";
import {BUILD, COMMON_CMAKE, JOBS, LLVM_VER, REPO, ROOT, SYSROOT, emenv, patch} from "./common.ts";

const env = await emenv();

await patch("wait_stdin.patch");

const extra = ["-DCLANGD_TIDY_CHECKS=OFF", "-DCLANGD_BUILD_XPC=OFF", "-DCLANGD_ENABLE_REMOTE=OFF"];
await $`emcmake cmake ${COMMON_CMAKE} ${extra} -B ${BUILD} -DCMAKE_EXE_LINKER_FLAGS=${"-pthread -s ENVIRONMENT=worker -s NO_INVOKE_RUN"}`.env(env);
await $`cmake --build ${BUILD} --target clang-resource-headers -j ${JOBS}`.env(env);
cpSync(`${BUILD}/lib/clang/${LLVM_VER.split(".")[0]}/include`, `${SYSROOT}/include`, {recursive: true});
mkdirSync(`${SYSROOT}/include/c++/v1/bits`, {recursive: true});
cpSync(`${REPO}/sysroot/bits-stdc++.h`, `${SYSROOT}/include/c++/v1/bits/stdc++.h`);

const SLIM = `${ROOT}/sysroot-slim`;
const INC = `${SLIM}/include/wasm32-wasip1`;
rmSync(SLIM, {recursive: true, force: true});
mkdirSync(`${SLIM}/include`, {recursive: true});
for (const f of new Bun.Glob("*.h").scanSync(`${SYSROOT}/include`)) cpSync(`${SYSROOT}/include/${f}`, `${SLIM}/include/${f}`);
cpSync(`${SYSROOT}/include/wasm32-wasip1`, INC, {recursive: true, dereference: true});
rmSync(`${INC}/noeh`, {recursive: true, force: true});
await $`patch -p1 -d ${SLIM} < ${REPO}/sysroot/tty.patch`;
for (const dir of [`${INC}/eh/c++/v1/bits`, `${SLIM}/include/c++/v1/bits`]) {
	mkdirSync(dir, {recursive: true});
	cpSync(`${REPO}/sysroot/bits-stdc++.h`, `${dir}/stdc++.h`);
}

const linker = [
	"-pthread", "-s ENVIRONMENT=worker", "-s NO_INVOKE_RUN", "-s EXIT_RUNTIME",
	"-s INITIAL_MEMORY=256MB", "-s ALLOW_MEMORY_GROWTH", "-s MAXIMUM_MEMORY=1GB", "-s STACK_SIZE=256kB",
	"-s EXPORTED_RUNTIME_METHODS=FS,callMain", "-s MODULARIZE", "-s EXPORT_ES6", "-s WASM_BIGINT",
	"-s ASYNCIFY", "-s PTHREAD_POOL_SIZE='Math.max(navigator.hardwareConcurrency, 8)'",
	"-s EXPORTED_FUNCTIONS=_main,__emscripten_thread_crashed",
	"--emit-tsd=clangd.d.ts",
	`--embed-file=${SLIM}/include@/usr/include`,
].join(" ");

await $`emcmake cmake ${COMMON_CMAKE} ${extra} -B ${BUILD} -DCMAKE_EXE_LINKER_FLAGS=${linker}`.env(env);

await $`cmake --build ${BUILD} --target clangd -j ${JOBS}`.env(env);

mkdirSync(`${REPO}/dist`, {recursive: true});
for (const f of new Bun.Glob("clangd*").scanSync(`${BUILD}/bin`)) cpSync(`${BUILD}/bin/${f}`, `${REPO}/dist/${f}`);
