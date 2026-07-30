import { describe, expect, it } from "vitest";
import { rewriteAppProtocolUrls } from "@/formats/native-renderer";

describe("native renderer asset URLs", () => {
	it("rewrites app protocol image URLs to copied attachment paths", () => {
		const html = '<p><img src="app://local/abc/OneAPI-4500%20额度.png?123"></p>';

		const rewritten = rewriteAppProtocolUrls(html, [{
			sourcePath: "assets/OneAPI-4500 额度.png",
			outputRelativePath: "assets/OneAPI-4500 额度.png",
		}]);

		expect(rewritten).toBe('<p><img src="assets/OneAPI-4500 额度.png"></p>');
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
});
