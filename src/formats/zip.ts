export type ZipEntry = {
	name: string;
	data: Uint8Array;
	crc32: number;
	localHeaderOffset: number;
};

const encoder = new TextEncoder();
const CRC32_TABLE = buildCrc32Table();

export function createZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
	const chunks: Uint8Array[] = [];
	const entries: ZipEntry[] = [];
	let offset = 0;

	for (const file of files) {
		const name = encoder.encode(file.name);
		const entry: ZipEntry = {
			name: file.name,
			data: file.data,
			crc32: crc32(file.data),
			localHeaderOffset: offset,
		};
		const header = createLocalFileHeader(name, entry);
		chunks.push(header, file.data);
		offset += header.byteLength + file.data.byteLength;
		entries.push(entry);
	}

	const centralDirectoryOffset = offset;
	const centralDirectoryChunks = entries.map((entry) => {
		const header = createCentralDirectoryHeader(encoder.encode(entry.name), entry);
		offset += header.byteLength;
		return header;
	});
	chunks.push(...centralDirectoryChunks);

	const centralDirectorySize = offset - centralDirectoryOffset;
	chunks.push(createEndOfCentralDirectory(entries.length, centralDirectorySize, centralDirectoryOffset));
	return concat(chunks);
}

function createLocalFileHeader(name: Uint8Array, entry: ZipEntry): Uint8Array {
	const header = new Uint8Array(30 + name.byteLength);
	const view = new DataView(header.buffer);
	view.setUint32(0, 0x04034b50, true);
	view.setUint16(4, 20, true);
	view.setUint16(6, 2048, true);
	view.setUint16(8, 0, true);
	view.setUint32(14, entry.crc32, true);
	view.setUint32(18, entry.data.byteLength, true);
	view.setUint32(22, entry.data.byteLength, true);
	view.setUint16(26, name.byteLength, true);
	header.set(name, 30);
	return header;
}

function createCentralDirectoryHeader(name: Uint8Array, entry: ZipEntry): Uint8Array {
	const header = new Uint8Array(46 + name.byteLength);
	const view = new DataView(header.buffer);
	view.setUint32(0, 0x02014b50, true);
	view.setUint16(4, 20, true);
	view.setUint16(6, 20, true);
	view.setUint16(8, 2048, true);
	view.setUint16(10, 0, true);
	view.setUint32(16, entry.crc32, true);
	view.setUint32(20, entry.data.byteLength, true);
	view.setUint32(24, entry.data.byteLength, true);
	view.setUint16(28, name.byteLength, true);
	view.setUint32(42, entry.localHeaderOffset, true);
	header.set(name, 46);
	return header;
}

function createEndOfCentralDirectory(entryCount: number, directorySize: number, directoryOffset: number): Uint8Array {
	const header = new Uint8Array(22);
	const view = new DataView(header.buffer);
	view.setUint32(0, 0x06054b50, true);
	view.setUint16(8, entryCount, true);
	view.setUint16(10, entryCount, true);
	view.setUint32(12, directorySize, true);
	view.setUint32(16, directoryOffset, true);
	return header;
}

function concat(chunks: Uint8Array[]): Uint8Array {
	const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
	const out = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}

function crc32(data: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of data) {
		crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function buildCrc32Table(): Uint32Array {
	const table = new Uint32Array(256);
	for (let i = 0; i < table.length; i++) {
		let crc = i;
		for (let bit = 0; bit < 8; bit++) {
			crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
		}
		table[i] = crc >>> 0;
	}
	return table;
}
