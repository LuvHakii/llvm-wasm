import { WASI } from 'node:wasi';
import { readFile } from 'node:fs/promises';
import { argv } from 'node:process';
const f = argv[2];
const wasi = new WASI({ version: 'preview1', args: [f], env: {}, preopens: { '/sandbox': '/tmp/pchtest/sandbox' } });
try {
  const wasm = await WebAssembly.compile(await readFile(f));
  const inst = await WebAssembly.instantiate(wasm, wasi.getImportObject());
  const code = wasi.start(inst);
  console.log(`[exit ${code ?? 0}]`);
} catch (e) { console.log(`[ERROR] ${String(e).split('\n')[0]}`); }
