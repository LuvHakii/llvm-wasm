import {resolve} from "node:path";

const DIST = resolve(process.argv[2] ?? "./dist");
const STDS = ["c++11", "c++14", "c++17", "c++20", "c++23"];
const SHIM = "/sysroot/include/wasm32-wasi/eh/c++/v1/bits/stdc++.h";
const BASE = [
	"--target=wasm32-wasi", "--sysroot=/sysroot", "-O0", "-fwasm-exceptions",
	"-mllvm", "-wasm-use-legacy-eh=false",
	"-isystem/sysroot/include/wasm32-wasi/eh/c++/v1", "-isystem/sysroot/include/c++/v1",
	"-isystem/sysroot/include/wasm32-wasi", "-isystem/sysroot/include",
];
const PROBE = `#include <bits/stdc++.h>\nusing namespace std;\nint main(){vector<int> v{3,1,2};sort(v.begin(),v.end());cout<<v[0];return 0;}\n`;

const {default: Llvm} = await import(`${DIST}/llvm.js`);

async function clang(args: string[], files: Record<string, any> = {}) {
	let err = "";
	const m = await Llvm({
		thisProgram: "/usr/bin/clang", noInitialRun: true,
		print: () => {}, printErr: (t: string) => { err += t + "\n"; },
	});
	for (const [path, data] of Object.entries(files)) m.FS.writeFile(path, data);
	const t = performance.now();
	let code = 0;
	try { code = m.callMain(["-fintegrated-cc1", ...args]) ?? 0; }
	catch (e: any) { code = e?.status ?? -1; }
	return {code, err, ms: performance.now() - t, m};
}

let failed = 0;
for (const std of STDS) {
	const gen = await clang([...BASE, "-x", "c++-header", `-std=${std}`, SHIM, "-o", "/stdc++.pch"]);
	let pch: Uint8Array | null = null;
	try { pch = gen.m.FS.readFile("/stdc++.pch"); } catch {}
	if (gen.code !== 0 || !pch?.length) {
		console.log(`${std}: GENERATE FAILED exit=${gen.code} ${gen.err.slice(0, 300)}`);
		failed++;
		continue;
	}

	// -fno-validate-pch is mandatory since --embed-file restamps the sysroot mtime per
	// instance, so clang(d) would reject it.
	const use = await clang(
		[...BASE, `-std=${std}`, "-Xclang", "-fno-validate-pch", "-include-pch", "/stdc++.pch",
			"-c", "/probe.cpp", "-o", "/probe.o"],
		{"/probe.cpp": PROBE, "/stdc++.pch": pch},
	);
	let obj = 0;
	try { obj = use.m.FS.readFile("/probe.o").length; } catch {}
	if (use.code !== 0 || !obj) {
		console.log(`${std}: UNUSABLE exit=${use.code} ${use.err.split("\n").filter(l => l).slice(0, 2).join(" ").slice(0, 300)}`);
		failed++;
		continue;
	}

	await Bun.write(`${DIST}/pch/stdc++-${std}.pch`, pch);
	console.log(`${std}: ${(pch.length / 1048576).toFixed(2)} MiB, gen ${(gen.ms / 1000).toFixed(2)}s, probe compile ${use.ms.toFixed(0)}ms`);
}

process.exit(failed ? 1 : 0);
