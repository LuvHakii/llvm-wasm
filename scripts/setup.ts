import {$} from "bun";
import {existsSync, mkdirSync, renameSync} from "node:fs";
import {EMSDK_VER, extractTar, JOBS, LLVM_VER, NATIVE, ROOT, SRC, SYSROOT, WASI_SDK_MAJOR, WASI_SDK_VER} from "./common.ts";

mkdirSync(ROOT, {recursive: true});

if (!existsSync(SRC)) {
	console.log(`clone llvm-project llvmorg-${LLVM_VER}`);
	await $`git clone --depth 1 --branch llvmorg-${LLVM_VER} --single-branch https://github.com/llvm/llvm-project.git ${SRC}`;
}

const emsdk = `${ROOT}/emsdk`;
if (!existsSync(emsdk)) {
	console.log(`install emsdk ${EMSDK_VER}`);
	await $`git clone --depth 1 https://github.com/emscripten-core/emsdk.git ${emsdk}`;
	await $`${emsdk}/emsdk install ${EMSDK_VER}`;
	await $`${emsdk}/emsdk activate ${EMSDK_VER}`;
}

if (!existsSync(SYSROOT)) {
	console.log(`fetch wasi-sysroot ${WASI_SDK_VER}`);
	const url = `https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${WASI_SDK_MAJOR}/wasi-sysroot-${WASI_SDK_VER}.tar.gz`;
	await extractTar(url, ROOT);
	renameSync(`${ROOT}/wasi-sysroot-${WASI_SDK_VER}`, SYSROOT);
}

if (!existsSync(`${NATIVE}/bin/llvm-tblgen`) || !existsSync(`${NATIVE}/bin/clang-tblgen`)) {
	console.log("build stage1 tblgen");
	const flags = [
		"-DCMAKE_BUILD_TYPE=Release",
		"-DLLVM_ENABLE_PROJECTS=clang",
		"-DLLVM_TARGETS_TO_BUILD=WebAssembly",
		"-DLLVM_INCLUDE_TESTS=OFF", "-DLLVM_INCLUDE_EXAMPLES=OFF",
		"-DLLVM_INCLUDE_BENCHMARKS=OFF", "-DLLVM_INCLUDE_DOCS=OFF",
		"-DLLVM_ENABLE_ZLIB=OFF", "-DLLVM_ENABLE_LIBXML2=OFF", "-DLLVM_ENABLE_TERMINFO=OFF",
	];
	await $`cmake -S ${SRC}/llvm -B ${NATIVE} -G Ninja ${flags}`;
	await $`ninja -C ${NATIVE} -j${JOBS} llvm-tblgen clang-tblgen`;
}
