import {$} from "bun";
import {existsSync, mkdirSync} from "node:fs";
import {EMSDK, emsdkVer, JOBS, NATIVE, REPO, ROOT, SRC} from "./common.ts";

mkdirSync(ROOT, {recursive: true});
await $`git -C ${REPO} submodule update --init --depth 1 llvm-project emsdk`;
const pin = (await $`git -C ${REPO} rev-parse :llvm-project`.text()).trim();
const wt = `${ROOT}/x86-asm-src`;
if (existsSync(wt)) {
	const head = (await $`git -C ${wt} rev-parse HEAD`.text()).trim();
	const dirty = (await $`git -C ${wt} status --porcelain --untracked-files=all`.text()).trim();
	const top = (await $`git -C ${wt} rev-parse --show-toplevel`.text()).trim();
	if (head !== pin || dirty || top !== wt) throw new Error(`Refusing to modify conflicting assembly worktree: ${wt}`);
} else {
	await $`git -C ${SRC} worktree add --detach ${wt} ${pin}`;
}
await $`${EMSDK}/emsdk install ${emsdkVer()}`;
await $`${EMSDK}/emsdk activate ${emsdkVer()}`;
const flags = [
	"-DCMAKE_BUILD_TYPE=Release", "-DLLVM_ENABLE_PROJECTS=clang", "-DLLVM_TARGETS_TO_BUILD=X86",
	"-DLLVM_INCLUDE_TESTS=OFF", "-DLLVM_INCLUDE_EXAMPLES=OFF", "-DLLVM_INCLUDE_BENCHMARKS=OFF",
	"-DLLVM_INCLUDE_DOCS=OFF", "-DLLVM_ENABLE_ZLIB=OFF", "-DLLVM_ENABLE_LIBXML2=OFF", "-DLLVM_ENABLE_TERMINFO=OFF",
];
await $`cmake -S ${wt}/llvm -B ${NATIVE} -G Ninja ${flags}`;
await $`cmake --build ${NATIVE} --target llvm-tblgen clang-tblgen -j ${JOBS}`;
