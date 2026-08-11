import {resolve} from 'node:path';

const DIST = resolve(process.argv[2] ?? './dist');
const HERE = import.meta.dir;
const PORT = Number(process.argv[3] ?? 8931);

const HEADERS = {
  // crossOriginIsolated for SharedArrayBuffer
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Embedder-Policy': 'require-corp',
};

Bun.serve({
	port: PORT,
	async fetch(req) {
		const path = new URL(req.url).pathname;
		const name = path === '/' ? '/index.html' : path;
		for (const dir of [HERE, DIST]) {
			const file = Bun.file(dir + name);
			if (await file.exists()) return new Response(file, {headers: HEADERS});
		}
		return new Response('not found', {status: 404, headers: HEADERS});
	},
});

console.log(`serving ${DIST} on http://localhost:${PORT}`);
