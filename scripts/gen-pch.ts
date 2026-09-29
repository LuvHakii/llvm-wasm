import {ConsoleStdout, WASI} from "@bjorn3/browser_wasi_shim";
import {resolve} from "node:path";

const DIST = resolve(process.argv[2] ?? "./dist");
const STDS = ["c++11", "c++14", "c++17", "c++20", "c++23"];
const SHIM = "/sysroot/include/wasm32-wasip1/eh/c++/v1/bits/stdc++.h";
const BASE = [
	"-fintegrated-cc1", "--target=wasm32-wasip1", "--sysroot=/sysroot", "-O0", "-fwasm-exceptions",
	"-mllvm", "-wasm-use-legacy-eh=false",
	"-isystem/sysroot/include/wasm32-wasip1/eh/c++/v1", "-isystem/sysroot/include/c++/v1",
	"-isystem/sysroot/include/wasm32-wasip1", "-isystem/sysroot/include",
];
const LD = [
	"--threads=1", "-m", "wasm32", "-L/sysroot/lib/wasm32-wasip1/eh", "-L/sysroot/lib/wasm32-wasip1",
	"/sysroot/lib/wasm32-wasip1/crt1.o", "/main.o",
];
const LIBS = ["-lc", "-lc++", "-lc++abi", "-lunwind", "-lclang_rt.builtins", "-o", "/main.wasm"];
const PROBE = `#include <bits/stdc++.h>\nusing namespace std;\nint main(){vector<int> v{3,1,2};sort(v.begin(),v.end());try{throw runtime_error("boom");}catch(const exception&e){cout<<v[0]<<v[1]<<v[2]<<' '<<e.what();}}\n`;

const {default: Llvm} = await import(`${DIST}/llvm.js`);

async function tool(name: string, args: string[], files: Record<string, any>, out: string) {
	let err = "";
	const m = await Llvm({
		thisProgram: `/usr/bin/${name}`, noInitialRun: true,
		print: () => {}, printErr: (t: string) => { err += t + "\n"; },
	});
	for (const [path, data] of Object.entries(files)) m.FS.writeFile(path, data);
	const t = performance.now();
	let code = 0;
	try { code = m.callMain(args) ?? 0; }
	catch (e: any) { code = e?.status ?? -1; }
	const ms = performance.now() - t;
	try {
		const file: Uint8Array = m.FS.readFile(out);
		if (file.length) return {file, ms};
	} catch {}
	throw {tool: name, exit: code, stderr: err.split("\n").filter(l => l).slice(0, 2)};
}

const link = (obj: Uint8Array, flags: string[] = []) => tool("wasm-ld", [...LD, ...flags, ...LIBS], {"/main.o": obj}, "/main.wasm");

let memory: WebAssembly.Memory;

async function run(bin: Uint8Array, imports: WebAssembly.Imports = {}) {
	let out = "";
	const dec = new TextDecoder();
	const sink = new ConsoleStdout(b => { out += dec.decode(b); });
	const wasi = new WASI(["main.wasm"], [], [sink, sink, sink], {debug: false});
	const {instance} = await WebAssembly.instantiate(bin, {wasi_snapshot_preview1: wasi.wasiImport, ...imports});
	memory = instance.exports.memory as WebAssembly.Memory;
	const code = wasi.start(instance as any);
	if (code !== 0) throw {exit: code, stdout: out};
	return out;
}

let failed = 0;
async function check(name: string, f: () => Promise<object>) {
	try { console.dir({name, ok: true, ...await f()}); }
	catch (e) { console.dir({name, ok: false, ...(e instanceof Error ? {error: e.message} : e as object)}, {depth: null}); failed++; }
}

for (const std of STDS) await check(std, async () => {
	const gen = await tool("clang", [...BASE, "-x", "c++-header", `-std=${std}`, "-fpch-instantiate-templates", SHIM, "-o", "/stdc++.pch"], {}, "/stdc++.pch");
	// -fno-validate-pch is mandatory since --embed-file restamps the sysroot mtime per
	// instance, so clang(d) would reject it.
	const use = await tool("clang",
		[...BASE, `-std=${std}`, "-Xclang", "-fno-validate-pch", "-include-pch", "/stdc++.pch",
			"-c", "/probe.cpp", "-o", "/main.o"],
		{"/probe.cpp": PROBE, "/stdc++.pch": gen.file}, "/main.o");
	const ld = await link(use.file);
	const out = await run(ld.file);
	if (out !== "123 boom") throw {stdout: out};
	await Bun.write(`${DIST}/pch/stdc++-${std}.pch`, gen.file);
	return {pch: gen.file.length, tGen: gen.ms, tCompile: use.ms, tLink: ld.ms};
});

const ICANON = 2, ECHO = 8, VMIN = 6, C_CC = 17;
let termios = new Uint8Array(60), action = -1;
new DataView(termios.buffer).setUint32(12, ICANON | ECHO, true);
termios[C_CC + VMIN] = 7;
const bytes = (ptr: number, n: number) => new Uint8Array(memory.buffer, ptr, n);
const tty = {
	tcgets(fd: number, ptr: number) { if (fd > 2) return -1; bytes(ptr, 60).set(termios); return 0; },
	tcsets(fd: number, a: number, ptr: number) { action = a; termios = bytes(ptr, 60).slice(); return 0; },
	winsize(fd: number, ptr: number) { bytes(ptr, 8).set(new Uint8Array(new Uint16Array([24, 80, 0, 0]).buffer)); return 0; },
};
const TTY = `#include <errno.h>
#include <termios.h>
int main(void) {
	struct termios t;
	struct winsize w;
	if (tcgetattr(0, &t) || !(t.c_lflag & ICANON) || t.c_cc[VMIN] != 7) return 1;
	cfmakeraw(&t);
	if (tcsetattr(0, TCSAFLUSH, &t) || tcgetattr(0, &t) || t.c_lflag & (ICANON | ECHO) || t.c_cc[VMIN] != 1) return 2;
	if (ioctl(1, TIOCGWINSZ, &w) || w.ws_row != 24 || w.ws_col != 80) return 3;
	if (tcgetattr(5, &t) != -1 || errno != ENOTTY) return 4;
	if (ioctl(0, 0x1234, 0) != -1 || errno == ENOTTY) return 5;
	return 0;
}
`;
await check("tty", async () => {
	const cc = await tool("clang", [...BASE, "-c", "/tty.c", "-o", "/main.o"], {"/tty.c": TTY}, "/main.o");
	await run((await link(cc.file, ["-ltty", "--wrap=ioctl"])).file, {tty});
	if (action !== 2) throw {action};
	return {};
});

process.exit(failed ? 1 : 0);
