import {$} from "bun";
import {existsSync, mkdirSync, renameSync} from "node:fs";
import {EMSDK, emsdkVer, extractTar, GCC, JOBS, NATIVE, REPO, ROOT, SRC, SYSROOT, WASI_SDK_MAJOR, WASI_SDK_VER} from "./common.ts";

mkdirSync(ROOT, {recursive: true});

await $`git -C ${REPO} submodule update --init --depth 1 emsdk`;
await $`git -C ${REPO} submodule update --init --depth 1 --force llvm-project`;
await $`git -C ${SRC} clean -fdq`;
// every C++ edit, for both builds: each touches files only one of them compiles, or both (clang-trim, driver)
const rules = [...new Bun.Glob("patches/*.yml").scanSync(REPO)].sort().map(f => `${REPO}/${f}`);
await $`${REPO}/scripts/apply-rules.sh ${SRC} ${rules}`;

const gcc = (await $`git -C ${REPO} rev-parse :gcc`.text()).trim();
await $`git init -q ${GCC}`;
if ((await $`git -C ${GCC} rev-parse -q --verify HEAD`.nothrow().text()).trim() !== gcc) {
	console.log(`fetch gcc ${gcc}, pb_ds headers only`);
	await $`git -C ${GCC} sparse-checkout set libstdc++-v3/include/ext/pb_ds`;
	await $`git -C ${GCC} fetch -q --depth 1 --filter=blob:none https://github.com/gcc-mirror/gcc.git ${gcc}`;
	await $`git -C ${GCC} checkout -q FETCH_HEAD`;
}

await $`${EMSDK}/emsdk install ${emsdkVer()}`;
await $`${EMSDK}/emsdk activate ${emsdkVer()}`;

if (!existsSync(SYSROOT)) {
	console.log(`fetch wasi-sysroot ${WASI_SDK_VER}`);
	const url = `https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${WASI_SDK_MAJOR}/wasi-sysroot-${WASI_SDK_VER}.tar.gz`;
	await extractTar(url, ROOT);
	renameSync(`${ROOT}/wasi-sysroot-${WASI_SDK_VER}`, SYSROOT);
}

const HOST_TOOLS = ["llvm-tblgen", "clang-tblgen", "clang-tidy-confusable-chars-gen"];
if (HOST_TOOLS.some(t => !existsSync(`${NATIVE}/bin/${t}`))) {
	console.log("build stage1 tblgen");
	const flags = [
		"-DCMAKE_BUILD_TYPE=Release",
		"-DLLVM_ENABLE_PROJECTS=clang;clang-tools-extra",
		"-DLLVM_TARGETS_TO_BUILD=WebAssembly",
		"-DLLVM_INCLUDE_TESTS=OFF", "-DLLVM_INCLUDE_EXAMPLES=OFF",
		"-DLLVM_INCLUDE_BENCHMARKS=OFF", "-DLLVM_INCLUDE_DOCS=OFF",
		"-DLLVM_ENABLE_ZLIB=OFF", "-DLLVM_ENABLE_LIBXML2=OFF", "-DLLVM_ENABLE_TERMINFO=OFF",
	];
	await $`cmake -S ${SRC}/llvm -B ${NATIVE} -G Ninja ${flags}`;
	await $`ninja -C ${NATIVE} -j${JOBS} ${HOST_TOOLS}`;
}
