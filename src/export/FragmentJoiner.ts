import type { DocumentFragment } from "@/types";

export function joinMarkdownFragments(fragments: DocumentFragment[]): string {
	if (fragments.length === 0) return "";

	const pieces = fragments.map((fragment) => fragment.markdown);
	for (let i = 0; i < fragments.length; i++) {
		const fragment = fragments[i];
		if (
			fragment.blockBoundaryBefore
			&& i > 0
			&& !fragments[i - 1].blockBoundaryAfter
		) {
			pieces[i - 1] = pieces[i - 1].replace(/[\t ]+$/, "");
		}
		if (
			fragment.blockBoundaryAfter
			&& i + 1 < fragments.length
			&& !fragments[i + 1].blockBoundaryBefore
		) {
			pieces[i + 1] = pieces[i + 1].replace(/^[\t ]+/, "");
		}
	}

	let output = "";
	let pendingBoundary = false;
	let pendingWhitespace = "";

	for (let i = 0; i < fragments.length; i++) {
		const boundaryBefore = i > 0 && (
			fragments[i - 1].blockBoundaryAfter
			|| fragments[i].blockBoundaryBefore
		);
		if (boundaryBefore && !pendingBoundary) {
			const trailingWhitespace = output.match(TRAILING_WHITESPACE_RE)?.[0] ?? "";
			output = output.slice(0, output.length - trailingWhitespace.length);
			pendingWhitespace = trailingWhitespace;
			pendingBoundary = true;
		}

		const piece = pieces[i];
		if (!pendingBoundary) {
			output += piece;
			continue;
		}

		const { leadingWhitespace, content } = splitLeadingWhitespace(
			piece,
			Boolean(fragments[i].blockBoundaryBefore),
		);
		pendingWhitespace += leadingWhitespace;
		if (content === "") continue;

		if (output !== "") {
			pendingWhitespace = ensureBlankLine(
				pendingWhitespace,
				output,
				content,
			);
		}
		output += pendingWhitespace + content;
		pendingWhitespace = "";
		pendingBoundary = false;
	}

	return output + pendingWhitespace;
}

const LEADING_WHITESPACE_RE = /^(?:(?:\r\n)|[\r\n\t ])*/;
const TRAILING_WHITESPACE_RE = /(?:(?:\r\n)|[\r\n\t ])*$/;

function splitLeadingWhitespace(
	markdown: string,
	preserveFinalIndentation: boolean,
): { leadingWhitespace: string; content: string } {
	const leadingWhitespace = markdown.match(LEADING_WHITESPACE_RE)?.[0] ?? "";
	if (!preserveFinalIndentation) {
		return {
			leadingWhitespace,
			content: markdown.slice(leadingWhitespace.length),
		};
	}

	const lastLineBreak = [...leadingWhitespace.matchAll(/\r\n|[\r\n]/g)].at(-1);
	if (lastLineBreak?.index === undefined) {
		return { leadingWhitespace: "", content: markdown };
	}

	const seamEnd = lastLineBreak.index + lastLineBreak[0].length;
	return {
		leadingWhitespace: leadingWhitespace.slice(0, seamEnd),
		content: leadingWhitespace.slice(seamEnd)
			+ markdown.slice(leadingWhitespace.length),
	};
}

function ensureBlankLine(
	whitespace: string,
	leftContent: string,
	rightContent: string,
): string {
	const lineBreakCount = whitespace.match(/\r\n|[\r\n]/g)?.length ?? 0;
	if (lineBreakCount >= 2) return whitespace;

	const eol = detectNearestEol(whitespace, leftContent, rightContent);
	return whitespace + eol.repeat(2 - lineBreakCount);
}

function detectNearestEol(
	whitespace: string,
	leftContent: string,
	rightContent: string,
): "\n" | "\r\n" {
	const seamMatches = whitespace.match(/\r\n|\n/g);
	if (seamMatches?.length) {
		return seamMatches[seamMatches.length - 1] === "\r\n" ? "\r\n" : "\n";
	}

	const leftMatches = leftContent.match(/\r\n|\n/g);
	if (leftMatches?.length) {
		return leftMatches[leftMatches.length - 1] === "\r\n" ? "\r\n" : "\n";
	}

	const rightMatch = rightContent.match(/\r\n|\n/);
	return rightMatch?.[0] === "\r\n" ? "\r\n" : "\n";
}
