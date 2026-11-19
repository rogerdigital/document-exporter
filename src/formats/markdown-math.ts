import katex from "katex";

export type MarkdownMath = {
	source: string;
	raw: string;
	display: boolean;
};

export function renderMathMl(math: MarkdownMath): string | undefined {
	try {
		let denied = false;
		const rendered = katex.renderToString(math.source, {
			output: "mathml",
			displayMode: math.display,
			strict: "error",
			trust: () => {
				denied = true;
				return false;
			},
		});
		if (denied) return undefined;
		return rendered.match(/<math\b[\s\S]*<\/math>/)?.[0];
	} catch (error) {
		if (error instanceof katex.ParseError) return undefined;
		throw error;
	}
}

// Skip code spans, image attributes and link destinations before recognizing
// dollars. As in Markdown math, a closing dollar cannot precede a digit.
export function replaceInlineMath(
	text: string,
	replace: (math: MarkdownMath) => string,
): string {
	if (!text.includes("$")) return text;

	const replaceText = (value: string): string =>
		value.replace(/\\[^\n]|\${2,}|\$(?!\s)((?:\\[^\n]|[^\\$\n])*?(?:\\[^\s]|[^\s\\$]))\$(?![$\d])/g,
			(raw: string, source: string | undefined) => source ? replace({ source, raw, display: false }) : raw);
	const protectedTokens = /\\[^\n]|(`+)(?!`)(?:[^`\n]|`+(?!`))*?\1(?!`)|!\[[^\]\n]*\]\([^\n)]*\)|\]\([^\n)]*\)/g;
	let result = "";
	let lastIndex = 0;
	for (const token of text.matchAll(protectedTokens)) {
		if (token[0].startsWith("\\")) continue;
		const start = token.index;
		result += replaceText(text.slice(lastIndex, start)) + token[0];
		lastIndex = start + token[0].length;
	}
	return result + replaceText(text.slice(lastIndex));
}

export function codeFenceOpening(line: string): string | undefined {
	const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
	if (match?.[1].startsWith("`") && match[2].includes("`")) return undefined;
	return match?.[1];
}

export function findCodeFenceEnd(lines: string[], start: number, fence: string): number {
	const closing = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`);
	let end = start + 1;
	while (end < lines.length && !closing.test(lines[end])) end++;
	return end;
}

export function readDisplayMath(lines: string[], start: number): { math: MarkdownMath; end: number } | undefined {
	const opening = lines[start].trim();
	if (opening === "$$") {
		for (let end = start + 1; end < lines.length; end++) {
			const line = lines[end].trim();
			if (codeFenceOpening(lines[end])) return undefined;
			if (line !== "$$") continue;
			const source = lines.slice(start + 1, end).join("\n").trim();
			if (source) return { math: { source, raw: lines.slice(start, end + 1).join("\n"), display: true }, end };
			return undefined;
		}
	}
	const source = opening.match(/^\$\$(?!\$)(.+?)\$\$$/)?.[1].trim();
	if (source) return { math: { source, raw: lines[start], display: true }, end: start };
	return undefined;
}
