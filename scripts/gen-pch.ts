import {ConsoleStdout, Directory, File, PreopenDirectory, WASI} from "@bjorn3/browser_wasi_shim";
import {resolve} from "node:path";
import {parseTar} from "nanotar";

const DIST = resolve(process.argv[2] ?? "./dist");
const STDS = ["c++11", "c++14", "c++17", "c++20", "c++23"];
const SHIM = "/include/c++/v1/bits/stdc++.h";
const EXTRA = ["assoc_container", "hash_policy", "list_update_policy", "priority_queue", "tree_policy", "trie_policy"].flatMap(h => ["-include", `ext/pb_ds/${h}.hpp`]);
const BASE = ["-fintegrated-cc1", "--target=wasm32-wasip1", "-O0", "-fwasm-exceptions", "-mllvm", "-wasm-use-legacy-eh=false"];
const LD = ["--threads=1", "-m", "wasm32", "-L/lib/wasm32-wasip1", "/lib/wasm32-wasip1/crt1.o", "/main.o"];
const LIBS = ["-lc", "-lc++", "-lc++abi", "-lunwind", "-lclang_rt.builtins", "-o", "/main.wasm"];
const PROBE = `#include <bits/stdc++.h>\nusing namespace std;\nint main(){vector<int> v{3,1,2};sort(v.begin(),v.end());try{throw runtime_error("boom");}catch(const exception&e){cout<<v[0]<<v[1]<<v[2]<<' '<<e.what();}}\n`;

const {default: Llvm} = await import(`${DIST}/llvm.js`);
const SYSROOT = [
	...parseTar(await Bun.file(`${DIST}/include.tar`).arrayBuffer()),
	...parseTar(await Bun.file(`${DIST}/lib.tar`).arrayBuffer()),
];

async function tool(name: string, args: string[], files: Record<string, any>, out: string) {
	let err = "";
	const m = await Llvm({
		thisProgram: `/usr/bin/${name}`, noInitialRun: true,
		print: () => {}, printErr: (t: string) => { err += t + "\n"; },
	});
	for (const {name, type, data} of SYSROOT) {
		if (type === "directory") m.FS.mkdirTree(`/${name}`);
		else if (type === "file") m.FS.createDataFile(`/${name}`, null, data ?? new Uint8Array(0), true, false, true);
	}
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
	const gen = await tool("clang", [...BASE, "-x", "c++-header", `-std=${std}`, "-fpch-instantiate-templates", ...EXTRA, SHIM, "-o", "/stdc++.pch"], {}, "/stdc++.pch");
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

const PBDS = `#include <iostream>
#include <ext/pb_ds/assoc_container.hpp>
#include <ext/pb_ds/tree_policy.hpp>
#include <ext/pb_ds/trie_policy.hpp>
#include <ext/pb_ds/priority_queue.hpp>
using namespace __gnu_pbds;
int main() {
	tree<int, null_type, std::less<int>, rb_tree_tag, tree_order_statistics_node_update> s;
	for (int x : {5, 1, 9, 3}) s.insert(x);
	gp_hash_table<int, int> g;
	cc_hash_table<int, int> c;
	g[7] = 70;
	c[8] = 80;
	__gnu_pbds::priority_queue<int, std::greater<int>, pairing_heap_tag> a, b;
	auto it = a.push(4);
	b.push(2);
	a.modify(it, 1);
	a.join(b);
	trie<std::string, null_type, trie_string_access_traits<>, pat_trie_tag, trie_prefix_search_node_update> t;
	for (auto w : {"apple", "app", "bat"}) t.insert(w);
	auto r = t.prefix_range("ap");
	std::cout << *s.find_by_order(2) << s.order_of_key(4) << g[7] << c[8] << a.top() << a.size() << std::distance(r.first, r.second);
}
`;
await check("pb_ds", async () => {
	const pch = new Uint8Array(await Bun.file(`${DIST}/pch/stdc++-c++17.pch`).arrayBuffer());
	const cc = await tool("clang", [...BASE, "-std=c++17", "-Xclang", "-fno-validate-pch", "-include-pch", "/stdc++.pch", "-c", "/p.cpp", "-o", "/main.o"], {"/p.cpp": PBDS, "/stdc++.pch": pch}, "/main.o");
	const out = await run((await link(cc.file)).file);
	if (out !== "527080122") throw {stdout: out};
	return {};
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

const SIGACTION = `#include <sys/types.h>
#include <errno.h>
#include <signal.h>
static volatile sig_atomic_t hit;
static void h(int s) { hit = s; }
int main(void) {
	struct sigaction sa, old;
	sigemptyset(&sa.sa_mask);
	sigaddset(&sa.sa_mask, SIGINT);
	sigaddset(&sa.sa_mask, SIGWINCH);
	sa.sa_flags = SA_RESTART;
	sa.sa_handler = h;
	if (sigaction(SIGINT, &sa, &old) || old.sa_handler != SIG_DFL) return 1;
	raise(SIGINT);
	if (hit != SIGINT || !sigismember(&sa.sa_mask, SIGINT) || sigismember(&sa.sa_mask, SIGQUIT) || !sigismember(&sa.sa_mask, SIGWINCH) || sizeof(sigset_t) != 128) return 2;
	if (sigaction(-1, &sa, 0) != -1 || errno != EINVAL) return 3;
	return 0;
}
`;
await check("sigaction", async () => {
	const cc = await tool("clang", [...BASE, "-D_WASI_EMULATED_SIGNAL", "-c", "/s.c", "-o", "/main.o"], {"/s.c": SIGACTION}, "/main.o");
	await run((await link(cc.file, ["-lwasi-emulated-signal"])).file, {});
	return {};
});

const CWD = `#include <stdio.h>
#include <string.h>
#include <unistd.h>
int main(void) {
	char b[64];
	if (!getcwd(b, sizeof b) || strcmp(b, "/work")) return 1;
	FILE *f = fopen("in.txt", "r");
	if (!f) return 2;
	return fgetc(f) == 'x' ? 0 : 3;
}
`;
await check("cwd", async () => {
	const cc = await tool("clang", [...BASE, "-c", "/c.c", "-o", "/main.o"], {"/c.c": CWD}, "/main.o");
	const bin = (await link(cc.file)).file;
	const root = new PreopenDirectory("/", new Map([["work", new Directory(new Map([["in.txt", new File(new TextEncoder().encode("x"))]]))]]));
	const sink = ConsoleStdout.lineBuffered(() => {});
	const wasi = new WASI(["main.wasm"], ["PWD=/work"], [sink, sink, sink, root], {debug: false});
	const {instance} = await WebAssembly.instantiate(bin, {wasi_snapshot_preview1: wasi.wasiImport});
	const code = wasi.start(instance as any);
	if (code !== 0) throw {exit: code};
	return {};
});

process.exit(failed ? 1 : 0);
