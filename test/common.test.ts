import {test} from "bun:test";
import assert from "node:assert/strict";
import {cpSync, mkdirSync, mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";

test("SDK environment preserves values and rejects initialization failures in paths with spaces", async () => {
	const repo = mkdtempSync(join(tmpdir(), "llvm wasm-"));
	try {
		mkdirSync(`${repo}/scripts`);
		mkdirSync(`${repo}/emsdk`);
		cpSync(`${import.meta.dir}/../scripts/common.ts`, `${repo}/scripts/common.ts`);
		await Bun.write(`${repo}/emsdk/emscripten-releases-tags.json`, JSON.stringify({aliases: {latest: "test"}, releases: {test: "commit"}}));
		const script = `${repo}/emsdk/emsdk_env.sh`;
		await Bun.write(script, "export LLVM_WASM_ENV_TEST='value=with spaces\nand a newline'\n");
		const {emenv} = await import(pathToFileURL(`${repo}/scripts/common.ts`).href);
		const env = await emenv();
		assert.equal(env.LLVM_WASM_ENV_TEST, "value=with spaces\nand a newline");
		assert.equal(env.CCACHE_COMPILERCHECK, "string:emscripten-releases-commit");
		await Bun.write(script, "return 23\n");
		await assert.rejects(emenv());
	} finally {
		rmSync(repo, {recursive: true, force: true});
	}
});
