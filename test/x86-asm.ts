import assert from "node:assert/strict";
import {resolve} from "node:path";

const dist = resolve(process.argv[2] ?? "./dist-x86-asm");
const {default: factory} = await import(`${dist}/clang-x86-asm.js`);
const wasmBinary = await Bun.file(`${dist}/clang-x86-asm.wasm`).arrayBuffer();

async function compile(flags: string[], source = 'static_assert(sizeof(void*) == 8);\nextern "C" int square(int x) { return x * x; }\n') {
	let diagnostics = "";
	const module = await factory({
		wasmBinary, noInitialRun: true,
		print: (line: string) => { diagnostics += line + "\n"; },
		printErr: (line: string) => { diagnostics += line + "\n"; },
	});
	module.FS.writeFile("/square.cpp", source);
	let code = 0;
	try { code = module.callMain(["/square.cpp", ...flags]) ?? 0; }
	catch (error) {
		if (error && typeof error === "object" && "status" in error && typeof error.status === "number") code = error.status;
		else throw error;
	}
	const assembly = code === 0 ? module.FS.readFile("/x86-asm/output.s", {encoding: "utf8"}) : "";
	return {code, diagnostics, assembly};
}

const square = await compile(["-O2"]);
assert.equal(square.code, 0, square.diagnostics);
assert.match(square.assembly, /^square:/m);
assert.match(square.assembly, /\bimul\b/);
assert.match(square.assembly, /\bret\b/);
assert.match(square.assembly, /\beax\b/);
const invalid = await compile(["--target=wasm32"]);
assert.notEqual(invalid.code, 0);
assert.match(invalid.diagnostics, /viewer owns target, source, stage and output/);
const standard = await compile(["-std=c++23", "-O2"], `#include <bits/stdc++.h>
static_assert(sizeof(void*) == 8 && sizeof(long) == 8);
extern "C" void fill(int* a, int n) { std::fill(a, a + n, 42); }
extern "C" void clear(int* a, int n) { std::memset(a, 0, n * sizeof(int)); }
int sum(std::vector<int> const& a) { int s = 0; for (int n : a) s += n; return s; }
`);
assert.equal(standard.code, 0, standard.diagnostics);
assert.match(standard.assembly, /^fill:/m);
assert.match(standard.assembly, /\bmemset\b/);
assert.match(standard.assembly, /\b_Z3sum/);
console.log("Assembly smoke passed: x86-64, standard headers, Intel syntax, alternate target rejected");
