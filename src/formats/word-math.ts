import { DOMParser, ParseError, type Element } from "@xmldom/xmldom";
import { escapeHtml } from "@/formats/html-document";
import { type MarkdownMath, renderMathMl } from "@/formats/markdown-math";

const wrap = (tag: string, value: string): string => `<m:${tag}>${value}</m:${tag}>`;
const run = (text: string, style = ""): string => wrap("r", style + wrap("t", escapeHtml(text)));
const mathNamespace = "http://www.w3.org/1998/Math/MathML";

class UnsupportedMath extends Error {}

export function renderWordMath(math: MarkdownMath): string | undefined {
	const mathMl = renderMathMl(math);
	if (!mathMl) return undefined;
	try {
		const root = new DOMParser().parseFromString(mathMl, "application/xml").documentElement;
		if (!root) return undefined;
		const content = wrap("oMath", convert(root));
		return math.display ? wrap("oMathPara", content) : content;
	} catch (error) {
		if (error instanceof UnsupportedMath || error instanceof ParseError) return undefined;
		throw error;
	}
}

function convert(node: Element): string {
	if (node.namespaceURI !== mathNamespace) throw new UnsupportedMath();
	const children = Array.from(node.childNodes).filter((n): n is Element => n.nodeType === 1);
	const args = (...tags: string[]): string => {
		if (children.length !== tags.length) throw new UnsupportedMath();
		return tags.map((tag, index) => wrap(tag, convert(children[index]))).join("");
	};

	switch (node.localName) {
		case "math":
		case "mrow":
		case "mstyle":
			return children.map(convert).join("");
		case "semantics":
			return convert(children[0]);
		case "mi":
		case "mn":
		case "mo":
		case "mtext":
			return run(node.textContent ?? "", runStyle(node));
		case "mspace":
			return run(" ");
		case "mfrac": {
			const thickness = node.getAttribute("linethickness");
			const props = thickness?.startsWith("0") ? '<m:fPr><m:type m:val="noBar"/></m:fPr>' : "";
			return wrap("f", props + args("num", "den"));
		}
		case "msqrt":
			return wrap("rad", '<m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/>' + wrap("e", children.map(convert).join("")));
		case "mroot":
			if (children.length !== 2) throw new UnsupportedMath();
			return wrap("rad", wrap("deg", convert(children[1])) + wrap("e", convert(children[0])));
		case "msub":
			return wrap("sSub", args("e", "sub"));
		case "msup":
			return wrap("sSup", args("e", "sup"));
		case "msubsup":
			return wrap("sSubSup", args("e", "sub", "sup"));
		case "munder":
		case "mover": {
			if (children.length !== 2) throw new UnsupportedMath();
			const above = node.localName === "mover";
			const accentType = above ? "accent" : "accentunder";
			if (node.getAttribute(accentType) === "true") {
				const mark = children[1].textContent ?? "";
				const base = wrap("e", convert(children[0]));
				if (mark === "‾") {
					return wrap("bar", `<m:barPr><m:pos m:val="${above ? "top" : "bot"}"/></m:barPr>` + base);
				}
				if (!above || Array.from(mark).length !== 1) throw new UnsupportedMath();
				return wrap("acc", `<m:accPr><m:chr m:val="${escapeHtml(mark)}"/></m:accPr>` + base);
			}
			return wrap(above ? "limUpp" : "limLow", args("e", "lim"));
		}
		case "munderover":
			if (children.length !== 3) throw new UnsupportedMath();
			return wrap("limUpp", wrap("e", wrap("limLow", wrap("e", convert(children[0])) +
				wrap("lim", convert(children[1])))) + wrap("lim", convert(children[2])));
		case "mtable":
			return wrap("m", children.map(convert).join(""));
		case "mtr":
			return wrap("mr", children.map(convert).join(""));
		case "mtd":
			return wrap("e", children.map(convert).join(""));
		default:
			throw new UnsupportedMath();
	}
}

function runStyle(node: Element): string {
	const variant = node.getAttribute("mathvariant");
	if (node.localName === "mtext") return "<m:rPr><m:nor/></m:rPr>";
	const style = variant === "bold" ? "b" : variant === "italic" ? "i" :
		variant === "bold-italic" ? "bi" : node.localName === "mi" && !variant ? "i" : "p";
	const scripts: Record<string, string> = {
		"double-struck": "double-struck",
		fraktur: "fraktur",
		script: "script",
		"sans-serif": "sans-serif",
		monospace: "monospace",
	};
	const script = variant && scripts[variant];
	const scriptProperty = script ? `<m:scr m:val="${script}"/>` : "";
	return wrap("rPr", scriptProperty + `<m:sty m:val="${style}"/>`);
}
