// Prod benchmark: bun test/bench-prod.ts [url] [runs] [stds,comma]
// Drives https://necron.dev/apps/playground in Chromium. Cold = fresh browser (empty HTTP cache).
import {chromium, type Page} from 'playwright';
import {readdirSync, readFileSync} from 'node:fs';

const URL = Bun.argv[2] ?? 'https://necron.dev/apps/playground';
const RUNS = Number(Bun.argv[3] ?? 3);
const STDS = (Bun.argv[4] ?? '11,17,20,23').split(',');
const CHROME = process.env.CHR;

const PROGS: Record<string, string> = {
	hello: '#include <bits/stdc++.h>\nusing namespace std;\nint main() { cout << "Hello World\\n"; }\n',
	stl: `#include <bits/stdc++.h>
using namespace std;
int main() {
	vector<int> v(200000); iota(v.begin(), v.end(), 0);
	mt19937 g(1); shuffle(v.begin(), v.end(), g); sort(v.begin(), v.end());
	map<string,int> m; for (int i = 0; i < 20000; i++) m[to_string(i)] = i;
	cout << v[100] << ' ' << m.size() << '\\n';
}
`,
	templ: `#include <bits/stdc++.h>
using namespace std;
template<int N> struct F { static const long long v = N * F<N-1>::v; };
template<> struct F<0> { static const long long v = 1; };
template<class T> T sum(T t) { return t; }
template<class T, class... R> T sum(T t, R... r) { return t + sum(r...); }
int main() {
	cout << F<20>::v << ' ' << sum(1, 2, 3) << '\\n';
	vector<function<long long(long long)>> fs; for (int i = 0; i < 50; i++) fs.push_back([i](long long x) { return x * i; });
	long long s = 0; for (auto& f : fs) s += f(3); cout << s << '\\n';
}
`,
	cpu: `#include <bits/stdc++.h>
int main() {
	const long long N = 20000000; std::vector<char> s(N + 1, 1); long long c = 0;
	for (long long i = 2; i <= N; i++) { if (s[i]) { c++; for (long long j = i * i; j <= N; j += i) s[j] = 0; } }
	std::printf("%lld\\n", c);
}
`,
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const f = (n: number) => n.toFixed(0);

// Pss (MB) summed over the browser process tree; shared pages counted once.
function tree(root: number): number[] {
	const kids = new Map<number, number[]>();
	for (const d of readdirSync('/proc').filter(x => /^\d+$/.test(x))) {
		try {
			const st = readFileSync(`/proc/${d}/stat`, 'utf8');
			const pp = Number(st.slice(st.lastIndexOf(')') + 2).split(' ')[1]);
			(kids.get(pp) ?? kids.set(pp, []).get(pp)!).push(Number(d));
		} catch {}
	}
	const out = [root], q = [root];
	while (q.length) for (const k of kids.get(q.pop()!) ?? []) { out.push(k); q.push(k); }
	return out;
}
function pssMB(root: number): number {
	let kb = 0;
	for (const p of tree(root)) {
		try { kb += Number(/Pss:\s+(\d+)/.exec(readFileSync(`/proc/${p}/smaps_rollup`, 'utf8'))![1]); } catch {}
	}
	return kb / 1024;
}

async function setCode(p: Page, code: string) {
	await p.locator('.cm-content').click();
	await p.keyboard.press('Control+A');
	await p.keyboard.insertText(code);
}

// compile+link+run ms: Run button swap attr on -> off, timed in page.
// Clicks again every 300ms until the run registers: the click is ignored while the toolchain loads.
async function run(p: Page): Promise<number> {
	const done = p.evaluate(() => new Promise<number>(res => {
		const root = Array.from(document.querySelectorAll('button')).find(b => /Run/.test(b.textContent || ''))!.querySelector('[data-scope=swap]')!;
		let t0 = 0;
		new MutationObserver(() => {
			const on = root.getAttribute('data-swap') === 'on';
			if (on && !t0) { t0 = performance.now(); (window as any).__started = true; }
			else if (!on && t0) res(performance.now() - t0);
		}).observe(root, {attributes: true, attributeFilter: ['data-swap']});
		(window as any).__started = false;
	}));
	const end = Date.now() + 120000;
	do { await p.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find(b => /Run/.test(b.textContent || ''))!; if (!b.disabled) b.click(); }); await sleep(300); } while (!(await p.evaluate(() => (window as any).__started)) && Date.now() < end);
	return Promise.race([done, sleep(120000).then(() => NaN)]);
}

async function session(std: string) {
	const tag = `--bench-tag=${crypto.randomUUID()}`;
	const b = await chromium.launch({executablePath: CHROME, args: ['--enable-features=SharedArrayBuffer', tag]});
	const pid = Math.min(...readdirSync('/proc').filter(x => /^\d+$/.test(x)).filter(d => { try { return readFileSync(`/proc/${d}/cmdline`, 'utf8').includes(tag); } catch { return false; } }).map(Number));
	const p = await b.newPage({viewport: {width: 1400, height: 900}});
	await p.goto(URL, {waitUntil: 'load', timeout: 120000});
	await sleep(4000);
	const base = pssMB(pid);
	const assets: Record<string, number> = {};
	p.on('response', async r => {
		const u = r.url();
		if (/static\/playground\/.*\.(wasm|pch|tar|js)\.br$|hxy3twmf/.test(u) || /\.(pch|tar|wasm)\.br$/.test(u)) assets[u.split('/').pop()!] ??= Number(r.headers()['content-length'] ?? 0);
	});
	let dlEnd = 0;
	p.on('requestfinished', r => { if (/static\/playground\/.*\.(wasm|pch|tar)\.br$/.test(r.url())) dlEnd = Date.now(); });
	let peak = base;
	const timer = setInterval(() => { peak = Math.max(peak, pssMB(pid)); }, 100);
	await p.getByRole('button', {name: /Python \(Pyodide\)/}).click();
	await p.getByText('C++ (Clang)').hover();
	const t0 = Date.now();
	await p.getByText(`C++${std}`, {exact: true}).click();
	// Run button stays disabled until toolchain is downloaded, instantiated, PCH loaded
	while (await p.evaluate(() => Array.from(document.querySelectorAll('button')).find(b => /Run/.test(b.textContent || ''))!.disabled)) await sleep(50);
	const ready = Date.now() - t0;
	await setCode(p, PROGS.hello);
	const first = await run(p);
	const ttfr = Date.now() - t0;
	const res: Record<string, number[]> = {};
	for (const name of Object.keys(PROGS)) {
		await setCode(p, PROGS[name]);
		await run(p); // warm this program
		res[name] = [];
		for (let i = 0; i < 5; i++) res[name].push(await run(p));
	}
	await sleep(500);
	const idle = pssMB(pid);
	clearInterval(timer);
	const wasm = await p.evaluate(async () => {
		try { return ((await (performance as any).measureUserAgentSpecificMemory()).bytes / 1048576); } catch { return NaN; }
	});
	await p.screenshot({path: `/tmp/bench-c++${std}.png`});
	await b.close();
	return {dl: dlEnd - t0, ready, ttfr, first, res, base, peak, idle, wasm, assets};
}

const rows: any[] = [];
for (const std of STDS) {
	const runs = [];
	for (let i = 0; i < RUNS; i++) { try { const r = await session(std); runs.push(r); console.error(`c++${std} cold#${i} dl=${f(r.dl)} ready=${f(r.ready)} ttfr=${f(r.ttfr)}ms`); } catch (e) { console.error(`c++${std} cold#${i} FAILED`, String(e).slice(0, 200)); } }
	if (runs.length) rows.push({std, runs});
}

console.log(`\nprod ${URL}, ${RUNS} cold sessions per std, warm = 5 runs/program, ms\n`);
console.log('| std | cold: downloads done | cold: ready (Run enabled) | cold: select->first output | first run only | hello | stl | templ | cpu | PSS base | PSS peak | PSS idle | JS+wasm heap |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const {std, runs} of rows) {
	const m = (fn: (r: any) => number) => f(med(runs.map(fn)));
	const w = (k: string) => f(med(runs.map((r: any) => med(r.res[k]))));
	console.log(`| c++${std} | ${m(r => r.dl)} | ${m(r => r.ready)} | ${m(r => r.ttfr)} | ${m(r => r.first)} | ${w('hello')} | ${w('stl')} | ${w('templ')} | ${w('cpu')} | ${m(r => r.base)} MB | ${m(r => r.peak)} MB | ${m(r => r.idle)} MB | ${m(r => r.wasm)} MB |`);
}
for (const {std, runs} of rows) console.log(`c++${std} br transfer MB:`, (Object.values(runs[0].assets as Record<string, number>).reduce((x, y) => x + y, 0) / 1048576).toFixed(1));
