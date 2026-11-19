import esbuild from "esbuild";
import process from "process";
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";

const prod = process.argv[2] === "production";

// Releases ship the bundled main.js, so include the notices of bundled dependencies.
const dependencyNotices = ["katex", "@xmldom/xmldom"]
	.map((name) => readFileSync(new URL(`./node_modules/${name}/LICENSE`, import.meta.url), "utf8").trim())
	.join("\n\n");

const context = await esbuild.context({
	banner: { js: `/*!\n${dependencyNotices}\n*/` },
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtinModules,
	],
	format: "cjs",
	target: "es2018",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
});

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
