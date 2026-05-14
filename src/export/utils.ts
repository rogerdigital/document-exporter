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

import { ExportProfileId } from "@/types";

export function extensionForProfile(profile: ExportProfileId): string {
	switch (profile) {
		case "markdown-bundle": return "md";
		case "html-document": return "html";
		case "pdf": return "pdf";
		case "docx": return "docx";
	}
}

export function longestCommonDirPrefix(paths: string[]): string {
	if (paths.length === 0) return "";
	const split = paths.map(p => p.split("/"));
	const minLen = Math.min(...split.map(s => s.length));
	let commonLen = 0;
	for (let i = 0; i < minLen; i++) {
		const seg = split[0][i];
		if (split.every(s => s[i] === seg)) commonLen = i + 1;
		else break;
	}
	// Must end at directory boundary (exclude the filename segment)
	return split[0].slice(0, commonLen - 1).join("/") + "/";
}

export function relativePathBetween(from: string, to: string): string {
	const fromParts = from.split("/");
	const toParts = to.split("/");

	// Find common prefix length (directory segments only, exclude filename)
	let commonLen = 0;
	while (commonLen < fromParts.length - 1 &&
		commonLen < toParts.length - 1 &&
		fromParts[commonLen] === toParts[commonLen]) {
		commonLen++;
	}

	const upCount = fromParts.length - commonLen - 1;
	const ups = upCount > 0 ? Array(upCount).fill("..").join("/") : "";
	const downParts = toParts.slice(commonLen).join("/");

	return ups ? `${ups}/${downParts}` : downParts;
}
