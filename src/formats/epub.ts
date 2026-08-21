import { markdownToBasicHtml, escapeHtml } from "@/formats/html-document";

export function toXhtml(html: string): string {
	return html
		.replace(/<br>/g, "<br/>")
		.replace(/<hr>/g, "<hr/>")
		.replace(/<input type="checkbox" checked disabled>/g, "☑")
		.replace(/<input type="checkbox" disabled>/g, "☐");
}

export function buildContainerXml(): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
}

export function buildContentOpf(
	title: string,
	chapterIds: string[],
	images: { name: string; mediaType: string }[],
	uuid: string = crypto.randomUUID(),
	modified: string = new Date().toISOString(),
): string {
	const manifest = [
		'<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
		'<item id="css" href="styles.css" media-type="text/css"/>',
		...chapterIds.map((id) =>
			`<item id="${id}" href="chapter-${id.slice(2)}.xhtml" media-type="application/xhtml+xml"/>`),
		// Sequential ids + generated filenames: raw attachment names with
		// spaces/&/quotes/CJK never become XML ids or hrefs.
		...images.map((img, i) =>
			`<item id="img${i + 1}" href="images/${img.name}" media-type="${img.mediaType}"/>`),
	].join("\n    ");
	// EPUB 3.3 requires seconds precision (YYYY-MM-DDThh:mm:ssZ); trim any
	// millisecond component the caller (or Date#toISOString) provides.
	const modifiedUtc = modified.replace(/\.\d+Z$/, "Z");
	const spine = ["nav", ...chapterIds]
		.map((id) => `<itemref idref="${id}"/>`)
		.join("\n    ");
	return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:${uuid}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${modifiedUtc}</meta>
  </metadata>
  <manifest>
    ${manifest}
  </manifest>
  <spine>
    ${spine}
  </spine>
</package>`;
}

export function buildNavXhtml(title: string, chapterTitles: string[]): string {
	const items = chapterTitles
		.map((t, i) => `<li><a href="chapter-${i + 1}.xhtml">${escapeXml(t)}</a></li>`)
		.join("");
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <nav epub:type="toc">
    <h1>${escapeXml(title)}</h1>
    <ol>${items}</ol>
  </nav>
</body>
</html>`;
}

export function buildChapterXhtml(title: string, bodyHtml: string): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function escapeXml(value: string): string {
	return escapeHtml(value);
}

export function imageMediaType(name: string): string {
	const ext = name.split(".").pop()?.toLowerCase() ?? "";
	const types: Record<string, string> = {
		png: "image/png",
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		gif: "image/gif",
		svg: "image/svg+xml",
		webp: "image/webp",
		bmp: "image/bmp",
	};
	return types[ext] ?? "application/octet-stream";
}
