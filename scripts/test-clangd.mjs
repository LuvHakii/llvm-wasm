#!/usr/bin/env node
// Drives a built clangd.js headlessly: initialize -> didOpen -> completion.
// Usage: node scripts/test-clangd.mjs [path/to/clangd.js]

import {resolve} from 'node:path';

const MODULE_PATH = resolve(process.argv[2] ?? './dist/clangd.js');
const WORKSPACE = '/src';
const FILE = `${WORKSPACE}/main.cpp`;
const SOURCE = `#include <bits/stdc++.h>\nusing namespace std;\nint main() {\n  vector<int> v{3,1,2};\n  v.\n  return 0;\n}\n`;

const enc = new TextEncoder();
const dec = new TextDecoder();

const stdinQueue = [];
let resolveStdin = () => {};
const pendingOut = [];
let buf = new Uint8Array(0);
const inbox = [];
const waiters = [];

function deframe(chunk) {
	const next = new Uint8Array(buf.length + chunk.length);
	next.set(buf, 0);
	next.set(chunk, buf.length);
	buf = next;
	for (;;) {
		let end = -1;
		for (let i = 0; i + 3 < buf.length; i++)
			if (buf[i] === 13 && buf[i + 1] === 10 && buf[i + 2] === 13 && buf[i + 3] === 10) {
				end = i;
				break;
			}
		if (end < 0) return;
		const m = /content-length:\s*(\d+)/i.exec(dec.decode(buf.subarray(0, end)));
		if (!m) {
			buf = buf.subarray(end + 4);
			continue;
		}
		const len = Number(m[1]);
		const start = end + 4;
		if (buf.length - start < len) return;
		const msg = JSON.parse(dec.decode(buf.subarray(start, start + len)));
		buf = buf.subarray(start + len);
		inbox.push(msg);
		while (waiters.length) waiters.shift()();
	}
}

function send(obj) {
	const body = enc.encode(JSON.stringify(obj));
	const header = enc.encode(`Content-Length: ${body.length}\r\n\r\n`);
	for (const b of header) stdinQueue.push(b);
	for (const b of body) stdinQueue.push(b);
	resolveStdin();
}

async function waitFor(pred, label, timeoutMs = 60000) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const hit = inbox.find(pred);
		if (hit) return hit;
		if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}`);
		await new Promise(r => {
			waiters.push(r);
			setTimeout(r, 50);
		});
	}
}

const {default: Clangd} = await import(MODULE_PATH);

const t0 = Date.now();
const clangd = await Clangd({
	thisProgram: '/usr/bin/clangd',
	stdinReady: async () => {
		if (stdinQueue.length === 0) return new Promise(r => (resolveStdin = r));
	},
	stdin: () => (stdinQueue.length ? stdinQueue.shift() : null),
	stdout: c => {
		pendingOut.push(c);
		if (pendingOut.length > 0) {
			const chunk = Uint8Array.from(pendingOut.splice(0));
			deframe(chunk);
		}
	},
	stderr: () => {},
	onExit: () => console.log('[clangd exited]'),
	onAbort: () => console.error('[clangd aborted]')
});
console.log(`module instantiated in ${Date.now() - t0}ms`);

clangd.FS.mkdir(WORKSPACE);
clangd.FS.writeFile(FILE, SOURCE);
clangd.FS.writeFile(
	`${WORKSPACE}/.clangd`,
	JSON.stringify({
		CompileFlags: {
			Add: [
				'--target=wasm32-wasi',
				'-std=c++20',
				'-fwasm-exceptions',
				'-isystem/usr/include/c++/v1',
				'-isystem/usr/include/wasm32-wasi/c++/v1',
				'-isystem/usr/include',
				'-isystem/usr/include/wasm32-wasi'
			]
		}
	})
);
clangd.callMain(['--background-index=false']);

const tInit = Date.now();
send({jsonrpc: '2.0', id: 1, method: 'initialize', params: {processId: null, rootUri: `file://${WORKSPACE}`, capabilities: {}}});
await waitFor(m => m.id === 1, 'initialize');
console.log(`initialize: ${Date.now() - tInit}ms`);
send({jsonrpc: '2.0', method: 'initialized', params: {}});

send({
	jsonrpc: '2.0',
	method: 'textDocument/didOpen',
	params: {textDocument: {uri: `file://${FILE}`, languageId: 'cpp', version: 1, text: SOURCE}}
});

const diag = await waitFor(m => m.method === 'textDocument/publishDiagnostics', 'diagnostics', 180000);
console.log(`diagnostics: ${diag.params.diagnostics.length} item(s)`);

const tComp = Date.now();
send({
	jsonrpc: '2.0',
	id: 2,
	method: 'textDocument/completion',
	params: {textDocument: {uri: `file://${FILE}`}, position: {line: 4, character: 4}}
});
const comp = await waitFor(m => m.id === 2, 'completion', 180000);
const items = comp.result?.items ?? comp.result ?? [];
console.log(`completion: ${items.length} items in ${Date.now() - tComp}ms`);
console.log('  sample:', items.slice(0, 8).map(i => i.label).join(', '));

const hasVectorMember = items.some(i => /push_back|size|begin/.test(i.label ?? ''));
console.log(hasVectorMember ? 'PASS: resolved std::vector members through the sysroot' : 'FAIL: no vector members - sysroot/include resolution broken');
process.exit(hasVectorMember ? 0 : 1);
