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
});
