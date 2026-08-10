import {createReadStream, existsSync, statSync} from 'node:fs';
import {createServer} from 'node:http';
import {extname, join, resolve} from 'node:path';

const DIST = resolve(process.argv[2] ?? './dist');
const HERE = resolve(import.meta.dirname);
const PORT = Number(process.argv[3] ?? 8931);

const TYPES = {
	'.js': 'text/javascript',
	'.mjs': 'text/javascript',
	'.wasm': 'application/wasm',
	'.html': 'text/html',
	'.json': 'application/json'
};

createServer((req, res) => {
	const url = new URL(req.url, 'http://x');
	const name = url.pathname === '/' ? '/index.html' : url.pathname;
	const candidates = [join(HERE, name), join(DIST, name)];
	const file = candidates.find(p => existsSync(p) && statSync(p).isFile());
	res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
	res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
	if (!file) {
		res.writeHead(404);
		res.end('not found');
		return;
	}
	res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
	res.writeHead(200);
	createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`serving ${DIST} on http://localhost:${PORT}`));
