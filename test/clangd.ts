import {chromium} from 'playwright';
import {resolve} from 'node:path';

declare global {
	interface Window { __done: boolean; __result: {ok: boolean} & Record<string, unknown>; }
}

const DIST = resolve(Bun.argv[2] ?? './dist');
const HEADERS = {'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp'};

const server = Bun.serve({
	port: 0,
	async fetch(req) {
		const path = new URL(req.url).pathname;
		const name = path === '/' ? '/clangd.html' : path;
		for (const dir of [import.meta.dir, DIST, resolve(import.meta.dir, '..')]) {
			const file = Bun.file(dir + name);
			if (await file.exists()) return new Response(file, {headers: HEADERS});
		}
		return new Response('not found', {status: 404, headers: HEADERS});
	},
});

const browser = await chromium.launch({args: ['--enable-features=SharedArrayBuffer']});
const page = await browser.newPage();
page.on('console', m => Promise.all(m.args().map(a => a.jsonValue())).then(v => console.log(...v), () => {}));
page.on('pageerror', e => console.error(e));

try {
	await page.goto(server.url.href, {waitUntil: 'domcontentloaded'});
	await page.waitForFunction(() => window.__done === true, null, {timeout: 600000});
	const result = await page.evaluate(() => window.__result);
	console.dir(result, {depth: null});
	process.exitCode = result?.ok ? 0 : 1;
} catch (e) {
	console.error(e);
	process.exitCode = 1;
} finally {
	await browser.close();
	server.stop(true);
}
