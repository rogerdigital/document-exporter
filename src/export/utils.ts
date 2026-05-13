export function normalizePath(p: string): string {
	const parts = p.split("/").filter(Boolean);
	const stack: string[] = [];
	for (const part of parts) {
		if (part === "..") { stack.pop(); }
		else if (part !== ".") { stack.push(part); }
	}
	return stack.join("/");
}

export function containsTraversal(p: string): boolean {
	const segments = p.split("/");
	return segments.some(s => s === ".." || s === ".");
}

const CODE_BLOCK_PLACEHOLDER = "\x00CB";
const INLINE_CODE_PLACEHOLDER = "\x00IC";

export function extractCodeBlocks(md: string): { text: string; blocks: string[] } {
	const blocks: string[] = [];
	let text = md.replace(/```[\s\S]*?```/g, (match) => {
		blocks.push(match);
		return `${CODE_BLOCK_PLACEHOLDER}${blocks.length - 1}${CODE_BLOCK_PLACEHOLDER}`;
	});
	text = text.replace(/`([^`\n]+)`/g, (match) => {
		blocks.push(match);
		return `${INLINE_CODE_PLACEHOLDER}${blocks.length - 1}${INLINE_CODE_PLACEHOLDER}`;
	});
	return { text, blocks };
}

export function restoreCodeBlocks(text: string, blocks: string[]): string {
	let result = text;
	result = result.replace(
		new RegExp(`${escapeRegex(INLINE_CODE_PLACEHOLDER)}(\\d+)${escapeRegex(INLINE_CODE_PLACEHOLDER)}`, "g"),
		(_, idx: string) => blocks[parseInt(idx)],
	);
	result = result.replace(
		new RegExp(`${escapeRegex(CODE_BLOCK_PLACEHOLDER)}(\\d+)${escapeRegex(CODE_BLOCK_PLACEHOLDER)}`, "g"),
		(_, idx: string) => blocks[parseInt(idx)],
	);
	return result;
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
