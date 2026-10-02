import {$} from "bun";
import {cpSync, mkdirSync} from "node:fs";
import {BUILD, COMMON_CMAKE, EMSDK, JOBS, LTO_FLAGS, REPO, emenv, patch} from "./common.ts";

const env = await emenv();

await patch("clangd-transport.patch");
await patch("clangd-pch.patch");
await patch("clang-tidy-trim.patch");
await patch("clang-trim.patch");
await patch("clang-driver-wasm-only.patch");
await patch("clangd-no-modules.patch");
await patch("clangd-no-banner.patch");

const api = new Function(`${await Bun.file(`${EMSDK}/upstream/emscripten/src/settings.js`).text()}; return INCOMING_MODULE_JS_API`)();

const linker = [
	"-pthread", "-s ENVIRONMENT=worker", "-s NO_INVOKE_RUN", "-s EXIT_RUNTIME",
	"-s INITIAL_MEMORY=192MB", "-s ALLOW_MEMORY_GROWTH", "-s MAXIMUM_MEMORY=1GB", "-s STACK_SIZE=256kB",
	"-s EXPORTED_RUNTIME_METHODS=FS,callMain", "-s MODULARIZE", "-s EXPORT_ES6",
	"-s PTHREAD_POOL_SIZE=6", `--js-library ${REPO}/scripts/memfs-mmap.js`,
	"-s EXPORTED_FUNCTIONS=_main,__emscripten_thread_crashed",
	`-s INCOMING_MODULE_JS_API=${[...api, "mainScriptUrlOrBlob"]}`,
	LTO_FLAGS,
].join(" ");

const extra = [
	"-DCLANGD_BUILD_XPC=OFF", "-DCLANGD_ENABLE_REMOTE=OFF",
	"-DCLANG_TIDY_ENABLE_STATIC_ANALYZER=OFF", "-DCLANG_TIDY_ENABLE_QUERY_BASED_CUSTOM_CHECKS=OFF",
];
await $`emcmake cmake ${COMMON_CMAKE} ${extra} -B ${BUILD} -DCMAKE_EXE_LINKER_FLAGS=${linker}`.env(env);

const link = (await $`ninja -C ${BUILD} -t commands clangd`.env(env).text()).trim().split("\n").at(-1)!;
await $`ninja -C ${BUILD} -j ${JOBS} ${link.split(/\s+/).filter(t => /^[^/-].*\.(o|a)$/.test(t))}`.env(env);
for (const v of ["jspi", "asyncify"])
	await $`bash -c ${link.replace(" -o bin/clangd.js ", ` -o bin/clangd-${v}.js -s ${v.toUpperCase()} --emit-tsd=clangd-${v}.d.ts `)}`.cwd(BUILD).env(env);

mkdirSync(`${REPO}/dist`, {recursive: true});
for (const f of new Bun.Glob("clangd*").scanSync(`${BUILD}/bin`)) cpSync(`${BUILD}/bin/${f}`, `${REPO}/dist/${f}`);
