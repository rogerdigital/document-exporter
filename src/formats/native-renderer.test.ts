import { describe, expect, it } from "vitest";
import {
	restoreAttachmentSourceUrls,
	rewriteAppProtocolUrls,
} from "@/formats/native-renderer";

describe("native renderer asset URLs", () => {
	it("restores copied attachment URLs to source paths before native rendering", () => {
		const markdown = [
			"![first](../assets/image.png)",
			'![second](../assets/b-image.png "caption")',
			'<object data="../../assets/reference.pdf"></object>',
		].join("\n");
		const attachments = [
			{ sourcePath: "assets/a/image.png", outputRelativePath: "assets/image.png" },
			{ sourcePath: "assets/b/image.png", outputRelativePath: "assets/b-image.png" },
			{ sourcePath: "assets/reference.pdf", outputRelativePath: "assets/reference.pdf" },
		];

		expect(
			restoreAttachmentSourceUrls(markdown, "notes/A.md", attachments),
		).toBe([
			"![first](../assets/a/image.png)",
			'![second](../assets/b/image.png "caption")',
			'<object data="../assets/reference.pdf"></object>',
		].join("\n"));
	});

	it("rewrites app protocol image URLs to copied attachment paths", () => {
		const html = '<p><img src="app://local/abc/OneAPI-4500%20额度.png?123"></p>';

		const rewritten = rewriteAppProtocolUrls(html, [{
			sourcePath: "assets/OneAPI-4500 额度.png",
			outputRelativePath: "assets/OneAPI-4500 额度.png",
		}]);

		expect(rewritten).toBe('<p><img src="assets/OneAPI-4500 额度.png"></p>');
	});

	it("rewrites native attachment links and object data URLs", () => {
		const html = [
			'<a href="app://local/vault/assets/reference.pdf">Reference</a>',
			'<object data="app://local/vault/assets/reference.pdf"></object>',
		].join("");
		const attachments = [{
			sourcePath: "assets/reference.pdf",
			outputRelativePath: "assets/reference.pdf",
		}];

		expect(rewriteAppProtocolUrls(html, attachments)).toBe([
			'<a href="assets/reference.pdf">Reference</a>',
			'<object data="assets/reference.pdf"></object>',
		].join(""));
	});

	it("uses the full source path when attachment basenames collide", () => {
		const html = [
			'<img src="app://local/vault/a/image.png">',
			'<img src="app://local/vault/b/image.png">',
		].join("");
		const attachments = [
			{ sourcePath: "a/image.png", outputRelativePath: "assets/image.png" },
			{ sourcePath: "b/image.png", outputRelativePath: "assets/b-image.png" },
		];

		expect(rewriteAppProtocolUrls(html, attachments)).toBe([
			'<img src="assets/image.png">',
			'<img src="assets/b-image.png">',
		].join(""));
	});

	it("does not guess when an app URL exposes only an ambiguous basename", () => {
		const html = '<img src="app://local/image.png">';
		const attachments = [
			{ sourcePath: "a/image.png", outputRelativePath: "assets/image.png" },
			{ sourcePath: "b/image.png", outputRelativePath: "assets/b-image.png" },
		];

		expect(rewriteAppProtocolUrls(html, attachments)).toBe(html);
	});

	it("resolves attachment paths relative to the rendered file in batch exports", () => {
		// Regression (native A02): nested batch documents must reference the
		// shared assets root from their own directory, not from the batch root.
		const html = '<img src="app://local/vault/images/landscape.png">';
		const attachments = [{
			sourcePath: "images/landscape.png",
			outputRelativePath: "assets/landscape.png",
		}];

		expect(rewriteAppProtocolUrls(html, attachments, {
			fromFile: "exports/folder/nested/part.html",
			assetsRoot: "exports/folder",
		})).toBe('<img src="../assets/landscape.png">');

		// A document at the assets root itself keeps the plain shared path.
		expect(rewriteAppProtocolUrls(html, attachments, {
			fromFile: "exports/folder/index.html",
			assetsRoot: "exports/folder",
		})).toBe('<img src="assets/landscape.png">');

		// Deeper nesting adds one more parent hop.
		expect(rewriteAppProtocolUrls(html, attachments, {
			fromFile: "exports/folder/a/b/part.html",
			assetsRoot: "exports/folder",
		})).toBe('<img src="../../assets/landscape.png">');
	});
});
