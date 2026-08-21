export function readStoredZipEntry(data: Uint8Array, targetName: string): string {
	const decoder = new TextDecoder();
	let offset = 0;

	while (offset + 30 <= data.byteLength) {
		const view = new DataView(
			data.buffer,
			data.byteOffset + offset,
			data.byteLength - offset,
		);
		const signature = view.getUint32(0, true);
		if (signature !== 0x04034b50) break;

		const compressionMethod = view.getUint16(8, true);
		const compressedSize = view.getUint32(18, true);
		const nameLength = view.getUint16(26, true);
		const extraLength = view.getUint16(28, true);
		const nameStart = offset + 30;
		const nameEnd = nameStart + nameLength;
		const contentStart = nameEnd + extraLength;
		const contentEnd = contentStart + compressedSize;

		if (contentEnd > data.byteLength) {
			throw new Error(`Invalid ZIP entry bounds for ${targetName}`);
		}

		const name = decoder.decode(data.slice(nameStart, nameEnd));
		if (name === targetName) {
			if (compressionMethod !== 0) {
				throw new Error(`Expected stored ZIP entry for ${targetName}`);
			}
			return decoder.decode(data.slice(contentStart, contentEnd));
		}

		offset = contentEnd;
	}

	throw new Error(`ZIP entry not found: ${targetName}`);
}
