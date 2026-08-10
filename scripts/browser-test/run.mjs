import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';

const DIST = resolve(process.argv[2] ?? './dist');
const PORT = 8931;

const server = spawn(process.execPath, [resolve(import.meta.dirname, 'serve.mjs'), DIST, String(PORT)], {stdio: 'inherit'});
await new Promise(r => setTimeout(r, 700));

const browser = await chromium.launch({args: ['--enable-features=SharedArrayBuffer']});
const page = await browser.newPage();
page.on('console', m => console.log('  [page]', m.text()));
page.on('pageerror', e => console.log('  [pageerror]', e.message.slice(0, 300)));

try {
	const PAGES = (process.argv[3] ?? '/').split(',');
	let result;
	for (const PAGE of PAGES) {
		console.log(`--- ${PAGE} ---`);
		await page.goto(`http://localhost:${PORT}${PAGE}`, {waitUntil: 'domcontentloaded'});
		await page.waitForFunction(() => window.__done === true, null, {timeout: 600000});
		result = await page.evaluate(() => window.__result);
		console.log('RESULT:', JSON.stringify(result, null, 2));
		if (!result?.ok) break;
	}
	process.exitCode = result?.ok ? 0 : 1;
} catch (e) {
	console.log('HARNESS ERROR:', e.message.slice(0, 400));
	process.exitCode = 1;
} finally {
	await browser.close();
	server.kill();
}
