import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
			obsidian: path.resolve(__dirname, "src/__mocks__/obsidian.ts"),
		},
	},
	test: {
		include: ["src/**/*.test.ts"],
	},
});
