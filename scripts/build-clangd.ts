import {$} from "bun";
import {cpSync, mkdirSync} from "node:fs";
import {BUILD, COMMON_CMAKE, JOBS, REPO, emenv, patch} from "./common.ts";

const env = await emenv();

await patch("wait_stdin.patch");

const linker = [
	"-pthread", "-s ENVIRONMENT=worker", "-s NO_INVOKE_RUN", "-s EXIT_RUNTIME",
	"-s INITIAL_MEMORY=192MB", "-s ALLOW_MEMORY_GROWTH", "-s MAXIMUM_MEMORY=1GB", "-s STACK_SIZE=256kB",
	"-s EXPORTED_RUNTIME_METHODS=FS,callMain", "-s MODULARIZE", "-s EXPORT_ES6",
	"-s MALLOC=mimalloc", "-s ASYNCIFY", "-s PTHREAD_POOL_SIZE='Math.max(navigator.hardwareConcurrency, 8)'",
	"-s EXPORTED_FUNCTIONS=_main,__emscripten_thread_crashed",
	"--emit-tsd=clangd.d.ts",
].join(" ");

const extra = ["-DCLANGD_TIDY_CHECKS=OFF", "-DCLANGD_BUILD_XPC=OFF", "-DCLANGD_ENABLE_REMOTE=OFF"];
await $`emcmake cmake ${COMMON_CMAKE} ${extra} -B ${BUILD} -DCMAKE_EXE_LINKER_FLAGS=${linker}`.env(env);

await $`cmake --build ${BUILD} --target clangd -j ${JOBS}`.env(env);

mkdirSync(`${REPO}/dist`, {recursive: true});
for (const f of new Bun.Glob("clangd*").scanSync(`${BUILD}/bin`)) cpSync(`${BUILD}/bin/${f}`, `${REPO}/dist/${f}`);
