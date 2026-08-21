import { describe, expect, it } from "vitest";
import {
	toXhtml,
	buildContainerXml,
	buildContentOpf,
	buildNavXhtml,
	buildChapterXhtml,
} from "@/formats/epub";

describe("toXhtml", () => {
	it("self-closes void elements", () => {
		expect(toXhtml("a<br>b<hr>c")).toBe("a<br/>b<hr/>c");
	});

	it("replaces checkbox inputs with characters", () => {
		expect(toXhtml('<li class="task-done"><input type="checkbox" checked disabled> x</li>'))
			.toBe('<li class="task-done">☑ x</li>');
		expect(toXhtml('<li class="task"><input type="checkbox" disabled> x</li>'))
			.toBe('<li class="task">☐ x</li>');
	});
});

describe("buildContainerXml", () => {
	it("points at the OEBPS package", () => {
		expect(buildContainerXml()).toContain('full-path="OEBPS/content.opf"');
	});
});

describe("buildContentOpf", () => {
	it("declares nav, css, chapters, and images with a spine", () => {
		const opf = buildContentOpf("My Book", ["ch1", "ch2"], [
			{ name: "image-1.png", mediaType: "image/png" },
		]);
		expect(opf).toContain('<dc:title>My Book</dc:title>');
		expect(opf).toContain('properties="nav"');
		expect(opf).toContain('href="chapter-1.xhtml"');
		expect(opf).toContain('href="chapter-2.xhtml"');
		expect(opf).toContain('<item id="img1" href="images/image-1.png" media-type="image/png"/>');
		expect(opf).toContain('idref="ch1"');
		expect(opf).toContain("<spine>");
	});

	it("emits spec-formatted dcterms:modified at seconds precision", () => {
		const opf = buildContentOpf("T", ["ch1"], [], "uuid-1", "2026-08-20T04:05:06.789Z");
		expect(opf).toMatch(/<meta property="dcterms:modified">2026-08-20T04:05:06Z<\/meta>/);
	});

	it("escapes XML in the title", () => {
		const opf = buildContentOpf("A & B <book>", ["ch1"], []);
		expect(opf).toContain("<dc:title>A &amp; B &lt;book&gt;</dc:title>");
	});
});

describe("buildNavXhtml", () => {
	it("lists chapter links", () => {
		const nav = buildNavXhtml("My Book", ["Intro", "Second"]);
		expect(nav).toContain('epub:type="toc"');
		expect(nav).toContain('href="chapter-1.xhtml">Intro</a>');
		expect(nav).toContain('href="chapter-2.xhtml">Second</a>');
	});
});

describe("buildChapterXhtml", () => {
	it("wraps body html in an XHTML skeleton with the stylesheet", () => {
		const chapter = buildChapterXhtml("Intro", "<h2>Intro</h2><p>Hi</p>");
		expect(chapter).toContain("<!DOCTYPE html>");
		expect(chapter).toContain('xmlns="http://www.w3.org/1999/xhtml"');
		expect(chapter).toContain('href="styles.css"');
		expect(chapter).toContain("<h2>Intro</h2>");
	});
});
