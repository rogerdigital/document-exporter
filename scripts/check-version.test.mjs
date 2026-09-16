import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const script = path.resolve(import.meta.dirname, "check-version.mjs");

function writeFixture(overrides = {}) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-version-"));
	const version = overrides.version ?? "1.2.3";
	const minApp = overrides.minApp ?? "1.4.0";
	fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "t", version }));
	fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
		id: "t",
		version: overrides.manifestVersion ?? version,
		minAppVersion: minApp,
	}));
	fs.writeFileSync(path.join(dir, "versions.json"), JSON.stringify(
		overrides.versions ?? { [version]: minApp },
	));
	fs.writeFileSync(path.join(dir, "package-lock.json"), JSON.stringify({
		name: "t",
		version: overrides.lockVersion ?? version,
		lockfileVersion: 3,
		packages: overrides.omitLockPackageRoot
			? {}
			: { "": { name: "t", version: overrides.lockPackageVersion ?? version } },
	}));
	return dir;
}

function run(dir, releaseTag) {
	const env = { ...process.env };
	delete env.RELEASE_TAG;
	if (releaseTag) env.RELEASE_TAG = releaseTag;
	return spawnSync(process.execPath, [script], { cwd: dir, env, encoding: "utf8" });
}

function withFixture(overrides, fn) {
	const dir = writeFixture(overrides);
	try {
		return fn(dir);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

test("accepts fully consistent metadata", () => {
	withFixture({}, (dir) => {
		const result = run(dir);
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /Version metadata is consistent: 1\.2\.3/);
	});
});

test("rejects package/manifest version drift", () => {
	withFixture({ manifestVersion: "1.2.2" }, (dir) => {
		const result = run(dir);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /manifest\.json=1\.2\.2, package\.json=1\.2\.3/);
	});
});

test("rejects a missing versions.json entry", () => {
	withFixture({ versions: { "1.0.0": "1.4.0" } }, (dir) => {
		const result = run(dir);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /versions\.json is missing 1\.2\.3/);
	});
});

test("rejects a minimum-version mapping mismatch", () => {
	withFixture({ versions: { "1.2.3": "1.5.0" } }, (dir) => {
		const result = run(dir);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /versions\.json\[1\.2\.3\] must equal manifest\.minAppVersion/);
	});
});

test("rejects lockfile root version drift", () => {
	withFixture({ lockVersion: "1.2.4" }, (dir) => {
		const result = run(dir);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /package-lock\.json root versions must equal 1\.2\.3/);
	});
});

test("rejects a missing lockfile package root version", () => {
	withFixture({ omitLockPackageRoot: true }, (dir) => {
		const result = run(dir);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /package-lock\.json root versions must equal 1\.2\.3/);
	});
});

test("rejects a mismatched release tag", () => {
	withFixture({}, (dir) => {
		const result = run(dir, "wrong-tag");
		assert.equal(result.status, 1);
		assert.match(result.stderr, /release tag=wrong-tag, package\.json=1\.2\.3/);
	});
});

test("accepts a matching release tag", () => {
	withFixture({}, (dir) => {
		const result = run(dir, "1.2.3");
		assert.equal(result.status, 0, result.stderr);
	});
});
