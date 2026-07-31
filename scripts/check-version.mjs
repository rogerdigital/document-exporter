import fs from "node:fs";

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const versions = JSON.parse(fs.readFileSync("versions.json", "utf8"));

const expected = packageJson.version;
const errors = [];

if (manifest.version !== expected) {
	errors.push(`manifest.json=${manifest.version}, package.json=${expected}`);
}
if (!Object.hasOwn(versions, expected)) {
	errors.push(`versions.json is missing ${expected}`);
}

const tag = process.env.RELEASE_TAG;
if (tag && tag !== expected) {
	errors.push(`release tag=${tag}, package.json=${expected}`);
}

if (errors.length > 0) {
	process.stderr.write(`${errors.join("\n")}\n`);
	process.exit(1);
}

process.stdout.write(`Version metadata is consistent: ${expected}\n`);
