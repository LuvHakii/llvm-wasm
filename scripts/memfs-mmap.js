addToLibrary({
	$heapMaps: {},
	$heapLast: '=null',
	$heapFree: node => {
		for (var k in heapMaps) if (heapMaps[k] === node) delete heapMaps[k];
		_emscripten_builtin_free(node.heap);
		node.heap = 0;
	},
	$heapFree__deps: ['$heapMaps', 'emscripten_builtin_free'],
	_mmap_js__deps: ['$SYSCALLS', '$FS', '$mmapAlloc', 'emscripten_builtin_memalign', '$heapMaps', '$heapLast', '$heapFree'],
	_mmap_js: (len, prot, flags, fd, offset, allocated, addr) => {
		try {
			var stream = SYSCALLS.getStreamFromFD(fd), node = stream.node, res;
			if (prot & 2 || node.mode & 146 || !FS.isFile(node.mode)) {
				res = FS.mmap(stream, len, offset, prot, flags);
			} else {
				if (!node.heap) {
					if (heapLast?.heap && !heapLast.maps) heapFree(heapLast);
					var ptr = mmapAlloc(node.usedBytes);
					if (!ptr) throw new FS.ErrnoError(48);
					growMemViews();
					HEAPU8.set(node.contents.subarray(0, node.usedBytes), ptr);
					node.heap = ptr;
					node.maps = 0;
				}
				node.maps++;
				heapLast = node;
				res = {ptr: node.heap + offset, allocated: false};
				heapMaps[res.ptr] = node;
			}
			growMemViews();
			HEAP32[allocated >> 2] = res.allocated;
			HEAPU32[addr >> 2] = res.ptr;
			return 0;
		} catch (e) {
			if (e.name !== 'ErrnoError') throw e;
			return -e.errno;
		}
	},
	_munmap_js__deps: ['$SYSCALLS', '$heapMaps', '$heapLast', '$heapFree'],
	_munmap_js: (addr, len, prot, flags, fd, offset) => {
		var node = heapMaps[addr];
		if (node && !--node.maps && node !== heapLast) heapFree(node);
		if (node || !(prot & 2)) return 0;
		try {
			SYSCALLS.doMsync(addr, SYSCALLS.getStreamFromFD(fd), len, flags, offset);
			return 0;
		} catch (e) {
			if (e.name !== 'ErrnoError') throw e;
			return -e.errno;
		}
	},
});
