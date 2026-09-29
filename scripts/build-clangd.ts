import {$} from "bun";
import {cpSync, mkdirSync} from "node:fs";
import {BUILD, COMMON_CMAKE, JOBS, REPO, emenv, patch} from "./common.ts";

const env = await emenv();

await patch("wait_stdin.patch");

const linker = [
	"-pthread", "-s ENVIRONMENT=worker", "-s NO_INVOKE_RUN", "-s EXIT_RUNTIME",
	"-s INITIAL_MEMORY=192MB", "-s ALLOW_MEMORY_GROWTH", "-s MAXIMUM_MEMORY=1GB", "-s STACK_SIZE=256kB",
	"-s EXPORTED_RUNTIME_METHODS=FS,callMain", "-s MODULARIZE", "-s EXPORT_ES6",
	"-s MALLOC=mimalloc", "-s PTHREAD_POOL_SIZE='Math.max(navigator.hardwareConcurrency, 8)'",
	"-s EXPORTED_FUNCTIONS=_main,__emscripten_thread_crashed",
	"-Wl,--thinlto-cache-dir=lto.cache",
].join(" ");

const extra = ["-DCLANGD_TIDY_CHECKS=OFF", "-DCLANGD_BUILD_XPC=OFF", "-DCLANGD_ENABLE_REMOTE=OFF"];
await $`emcmake cmake ${COMMON_CMAKE} ${extra} -B ${BUILD} -DCMAKE_EXE_LINKER_FLAGS=${linker}`.env(env);

const link = (await $`ninja -C ${BUILD} -t commands clangd`.env(env).text()).trim().split("\n").at(-1)!;
await $`ninja -C ${BUILD} -j ${JOBS} ${link.split(/\s+/).filter(t => /^[^/-].*\.(o|a)$/.test(t))}`.env(env);
for (const v of ["jspi", "asyncify"])
	await $`bash -c ${link.replace(" -o bin/clangd.js ", ` -o bin/clangd-${v}.js -s ${v.toUpperCase()} --emit-tsd=clangd-${v}.d.ts `)}`.cwd(BUILD).env(env);

mkdirSync(`${REPO}/dist`, {recursive: true});
for (const f of new Bun.Glob("clangd*").scanSync(`${BUILD}/bin`)) cpSync(`${BUILD}/bin/${f}`, `${REPO}/dist/${f}`);
