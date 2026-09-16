import fs from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";

const destination = process.argv[2];
if (!destination || process.argv.length !== 3) {
  throw new Error("Usage: node scripts/create-release-fixtures.mjs <new-or-empty-directory>");
}
const root = path.resolve(destination);
if (fs.existsSync(root) && (!fs.statSync(root).isDirectory() || fs.readdirSync(root).length)) {
  throw new Error(`Refusing non-empty or non-directory destination: ${root}`);
}
fs.mkdirSync(root, { recursive: true });
const manifest = [];
function put(name, data) {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data, { flag: "wx" });
  manifest.push({
    path: name,
    sha256: createHash("sha256").update(data).digest("hex"),
  });
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const label = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([label, data])));
  return Buffer.concat([length, label, data, checksum]);
}
function png(width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const pixels = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    for (let x = 0; x < width; x++) {
      const offset = row + 1 + x * 3;
      pixels[offset] = rgb[0];
      pixels[offset + 1] = rgb[1];
      pixels[offset + 2] = rgb[2];
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

put("images/landscape.png", png(640, 240, [210, 30, 30]));
put("images/portrait.png", png(240, 640, [30, 30, 210]));
put("collision/a/img.png", png(160, 100, [210, 30, 30]));
put("collision/b/img.png", png(160, 100, [30, 30, 210]));
put("collision/a/A.md", "# Collision A\n\nRed image:\n\n![[img.png]]\n");
put("collision/b/B.md", "# Collision B\n\nBlue image:\n\n![[img.png]]\n");
put("content.md", [
  "---", "title: Release acceptance", "---", "# Release acceptance", "",
  "BEGIN-CONTENT 中文导出 😀 café", "",
  "## Heading two", "### Heading three", "#### Heading four",
  "##### Heading five", "###### Heading six", "",
  "**Bold** and *italic* and `inline code`.", "",
  "1. Ordered one", "2. Ordered two", "", "- Bullet one", "- Bullet two", "",
  "| Name | Value |", "| --- | --- |", "| Alpha | 123 |", "| 中文 | 456 |", "",
  "```ts", "const sentinel = 'CODE-CONTENT';", "```", "",
  "[External link](https://example.com/)", "",
  "![Landscape](images/landscape.png)", "",
  "![Portrait](images/portrait.png)", "", "END-CONTENT", "",
].join("\n"));
put("folder/index.md", "# Folder index\n\n[[nested/part]]\n\n![[nested/part]]\n\nEND-INDEX\n");
put("folder/nested/part.md", "# Nested part\n\nEMBED-SENTINEL\n\n![Local](../../images/landscape.png)\n\n[[../index]]\n");
put("folder/nested/third.md", "# Third\n\nTHIRD-SENTINEL\n\n[[part]]\n");
put("heading-host.md", "# Heading host\n\nBefore\n\n![[heading-source#Wanted]]\n\nAfter\n");
put("heading-source.md", "# Source\n\n## Wanted\n\nWANTED-SENTINEL\n\n## Excluded\n\nEXCLUDED-SENTINEL\n");
put("adjacency.md", "![[images/landscape.png]]\n## After image\n\nAFTER-IMAGE-SENTINEL\n");
put("export-report.md", "# Preserve this document\n\nREPORT-DOCUMENT-SENTINEL\n\n[[MissingReportTarget]]\n");
put("failure/missing.md", "# Missing references\n\n![[NoSuchImage.png]]\n\n[[NoSuchNote]]\n");
put("failure/cycle-a.md", "# Cycle A\n\n![[cycle-b]]\n");
put("failure/cycle-b.md", "# Cycle B\n\n![[cycle-a]]\n");
put("limitations.md", [
  "# Documented limitations", "", "![[heading-source#^absent-block]]", "",
  "```dataview", 'LIST FROM "folder"', "```", "",
  "- [ ] Task item", "", "> [!note] Callout", "> CALLOUT-SENTINEL", "",
  "$$x^2 + y^2 = z^2$$", "", "```mermaid", "graph LR", "A-->B", "```", "",
].join("\n"));
put("long.md", "# Long document\n\n" + Array.from({ length: 120 }, (_, i) =>
  `## Section ${i + 1}\n\nPAGE-SENTINEL-${i + 1} 中文 long document.\n\n`
  + "| Column A | Column B |\n| --- | --- |\n| Left | Right |\n\n"
).join(""));
for (let i = 1; i <= 501; i++) {
  const name = String(i).padStart(3, "0");
  put(`bulk/note-${name}.md`, `# Bulk ${name}\n\nBULK-SENTINEL-${name}\n`);
}
fs.writeFileSync(path.join(root, "fixture-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
process.stdout.write(`Created ${manifest.length} synthetic fixture files in ${root}\n`);
