# Declarative Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `getSettingDefinitions()` on the settings tab so Document Exporter's settings appear in Obsidian 1.13+ settings search, and clear the only real community-plugin scorecard warning.

**Architecture:** The settings tab gains the declarative API (`getSettingDefinitions` + explicit `getControlValue`/`setControlValue`) alongside the existing imperative `display()`. Obsidian 1.13+ renders from the definitions and bypasses `display()`; users on 1.4.0–1.12.x keep the legacy `display()` UI. Setting names/descriptions/aliases live in one shared `SETTING_META` constant used by both paths. `minAppVersion` stays at 1.4.0 — no user is dropped.

**Tech Stack:** Obsidian declarative settings API (`obsidian@^1.13.1` types, `SettingDefinitionItem` / `SettingTextControl` / `SettingDropdownControl` / `SettingToggleControl` / `SettingDefinitionGroup`), `eslint-plugin-obsidianmd@^0.4.1` (provides the `settings-tab/prefer-setting-definitions` rule that the scorecard runs), Vitest.

**Background (why this is safe):**

- eslint-plugin-obsidianmd 0.4.1 warns: *"This PluginSettingTab does not implement getSettingDefinitions(); its settings will not appear in Obsidian's settings search for users on 1.13.0 or later."* The repo pins 0.3.0 locally, which lacks the rule — that's why local lint is green while the scorecard warns.
- The `no-deprecated-display` rule in 0.4.1 only fires when `minAppVersion >= 1.13.0`. Ours is 1.4.0, so keeping `display()` is lint-clean and required for old-version users.
- `obsidian` is a devDependency marked `external` in `esbuild.config.mjs` — upgrading it changes types only, nothing is bundled.
- `vitest.config.ts` aliases `obsidian` → `src/__mocks__/obsidian.ts`, whose `PluginSettingTab` is an empty class. Since we define `getSettingDefinitions`/`getControlValue`/`setControlValue` on the subclass (not inherited), unit tests work against the mock without changes. Import Obsidian types with `import type` so they are erased at runtime.

---

### Task 1: Upgrade dev dependencies

**Files:**
- Modify: `package.json` (devDependencies), `package-lock.json`

- [ ] **Step 1: Upgrade both dev dependencies**

```bash
npm install -D obsidian@^1.13.1 eslint-plugin-obsidianmd@^0.4.1
```

- [ ] **Step 2: Verify nothing regressed**

```bash
npx tsc -noEmit -skipLibCheck && npm run build && npm test
```

Expected: type check passes, build succeeds, all existing tests pass. (The 0.4.1 linter may now print warnings; that's expected and addressed in Task 4.)

- [ ] **Step 3: Confirm the new types are visible**

```bash
grep -c "getSettingDefinitions" node_modules/obsidian/obsidian.d.ts
```

Expected: a count ≥ 1.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: upgrade obsidian types and obsidianmd lint plugin"
```

---

### Task 2: Declarative settings on the settings tab (TDD)

**Files:**
- Create: `src/settings/settings-tab.test.ts`
- Modify: `src/settings/settings-tab.ts` (full rewrite shown below)

- [ ] **Step 1: Write the failing tests**

Create `src/settings/settings-tab.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { Platform } from "obsidian";
import { DocumentExporterSettingTab } from "@/settings/settings-tab";
import { DEFAULT_SETTINGS, ExportSettings } from "@/types";

function makePlugin(settings: ExportSettings = { ...DEFAULT_SETTINGS }) {
	return {
		settings,
		saveSettings: vi.fn().mockResolvedValue(undefined),
	} as never;
}

function makeTab(plugin = makePlugin()) {
	return new DocumentExporterSettingTab({} as never, plugin);
}

afterEach(() => {
	Platform.isDesktopApp = true;
});

describe("DocumentExporterSettingTab#getSettingDefinitions", () => {
	it("declares the output folder as a text control", () => {
		const defs = makeTab().getSettingDefinitions();
		const first = defs[0] as {
			name: string;
			control: { type: string; key: string; placeholder?: string };
		};
		expect(first.name).toBe("Output folder");
		expect(first.control.type).toBe("text");
		expect(first.control.key).toBe("defaultOutputFolder");
		expect(first.control.placeholder).toBe("Exports");
	});

	it("declares the default format as a dropdown with all desktop profiles", () => {
		const defs = makeTab().getSettingDefinitions();
		const dropdown = defs[1] as {
			control: { type: string; key: string; options: Record<string, string> };
		};
		expect(dropdown.control.type).toBe("dropdown");
		expect(dropdown.control.key).toBe("defaultProfile");
		expect(Object.keys(dropdown.control.options).sort()).toEqual(
			["docx", "html-document", "markdown-bundle", "pdf"],
		);
	});

	it("omits PDF from the dropdown on mobile", () => {
		Platform.isDesktopApp = false;
		const defs = makeTab().getSettingDefinitions();
		const dropdown = defs[1] as { control: { options: Record<string, string> } };
		expect(Object.keys(dropdown.control.options).sort()).toEqual(
			["docx", "html-document", "markdown-bundle"],
		);
	});

	it("groups the three advanced toggles under one heading", () => {
		const defs = makeTab().getSettingDefinitions();
		const group = defs[2] as {
			type: string;
			heading: string;
			items: { control: { type: string; key: string; defaultValue: boolean } }[];
		};
		expect(group.type).toBe("group");
		expect(group.heading).toBe("Advanced");
		expect(group.items.map((i) => i.control.key)).toEqual([
			"includeSourcePathComments",
			"copyAttachments",
			"overwriteExisting",
		]);
		expect(group.items.every((i) => i.control.type === "toggle")).toBe(true);
	});

	it("adds search aliases to every setting", () => {
		const defs = makeTab().getSettingDefinitions();
		const flat = [
			defs[0],
			defs[1],
			...(defs[2] as { items: unknown[] }).items,
		] as { aliases?: string[] }[];
		expect(flat.every((d) => Array.isArray(d.aliases) && d.aliases.length > 0)).toBe(true);
	});
});

describe("DocumentExporterSettingTab control value bridge", () => {
	it("reads values from plugin settings", () => {
		const plugin = makePlugin({ ...DEFAULT_SETTINGS, overwriteExisting: true });
		const tab = makeTab(plugin);
		expect(tab.getControlValue("overwriteExisting")).toBe(true);
	});

	it("normalizes an unsupported stored profile for mobile", () => {
		Platform.isDesktopApp = false;
		const plugin = makePlugin(); // defaultProfile is "pdf", not offered on mobile
		const tab = makeTab(plugin);
		expect(tab.getControlValue("defaultProfile")).toBe("markdown-bundle");
	});

	it("writes values and persists through saveSettings", async () => {
		const plugin = makePlugin();
		const tab = makeTab(plugin);
		await tab.setControlValue("copyAttachments", false);
		expect(plugin.settings.copyAttachments).toBe(false);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
	});

	it("rejects unsupported profile values", async () => {
		Platform.isDesktopApp = false;
		const plugin = makePlugin();
		const tab = makeTab(plugin);
		await tab.setControlValue("defaultProfile", "pdf");
		expect(plugin.settings.defaultProfile).toBe(DEFAULT_SETTINGS.defaultProfile);
		expect(plugin.saveSettings).not.toHaveBeenCalled();
	});

	it("ignores unknown keys", async () => {
		const plugin = makePlugin();
		const tab = makeTab(plugin);
		await tab.setControlValue("nope", 1);
		expect(plugin.saveSettings).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/settings/settings-tab.test.ts
```

Expected: FAIL — `tab.getSettingDefinitions is not a function`.

- [ ] **Step 3: Implement the declarative API**

Replace the full contents of `src/settings/settings-tab.ts` with:

```ts
import { PluginSettingTab, App, Platform, Setting, debounce } from "obsidian";
import type { SettingDefinitionItem } from "obsidian";
import { ExportProfileId, DEFAULT_SETTINGS } from "@/types";
import {
	getAvailableProfiles,
	resolveSupportedProfile,
} from "@/export/ProfileCapabilities";
import type DocumentExporterPlugin from "@/main";

const PROFILE_LABELS: Record<ExportProfileId, string> = {
	pdf: "PDF",
	docx: "Word document",
	"markdown-bundle": "Markdown bundle",
	"html-document": "HTML document",
};

// Single source of truth for setting text. display() renders it for
// Obsidian < 1.13; getSettingDefinitions() exposes it to settings search.
const SETTING_META = {
	defaultOutputFolder: {
		name: "Output folder",
		desc: "Exported files will be saved here (relative to vault root). You can change this path to any folder in your vault.",
		aliases: ["directory", "destination", "save location", "export path"],
	},
	defaultProfile: {
		name: "Default export format",
		desc: "Choose the default format when opening the export dialog.",
		aliases: ["pdf", "word", "docx", "html", "markdown", "file type"],
	},
	includeSourcePathComments: {
		name: "Include source path comments",
		desc: "Add HTML comments showing the source path of each section.",
		aliases: ["origin", "provenance"],
	},
	copyAttachments: {
		name: "Copy attachments",
		desc: "Copy referenced images and files into the export bundle.",
		aliases: ["images", "assets", "media"],
	},
	overwriteExisting: {
		name: "Overwrite existing exports",
		desc: "Overwrite if the output folder already exists. Otherwise a timestamped folder is created.",
		aliases: ["replace", "timestamped folder"],
	},
} as const;

type SettingKey = keyof typeof SETTING_META;

export class DocumentExporterSettingTab extends PluginSettingTab {
	plugin: DocumentExporterPlugin;

	constructor(app: App, plugin: DocumentExporterPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const formatOptions: Record<string, string> = {};
		for (const profile of getAvailableProfiles(Platform.isDesktopApp)) {
			formatOptions[profile] = PROFILE_LABELS[profile];
		}

		return [
			{
				name: SETTING_META.defaultOutputFolder.name,
				desc: SETTING_META.defaultOutputFolder.desc,
				aliases: [...SETTING_META.defaultOutputFolder.aliases],
				control: {
					type: "text",
					key: "defaultOutputFolder",
					defaultValue: DEFAULT_SETTINGS.defaultOutputFolder,
					placeholder: "Exports",
				},
			},
			{
				name: SETTING_META.defaultProfile.name,
				desc: SETTING_META.defaultProfile.desc,
				aliases: [...SETTING_META.defaultProfile.aliases],
				control: {
					type: "dropdown",
					key: "defaultProfile",
					defaultValue: DEFAULT_SETTINGS.defaultProfile,
					options: formatOptions,
				},
			},
			{
				type: "group",
				heading: "Advanced",
				items: [
					{
						name: SETTING_META.includeSourcePathComments.name,
						desc: SETTING_META.includeSourcePathComments.desc,
						aliases: [...SETTING_META.includeSourcePathComments.aliases],
						control: {
							type: "toggle",
							key: "includeSourcePathComments",
							defaultValue: DEFAULT_SETTINGS.includeSourcePathComments,
						},
					},
					{
						name: SETTING_META.copyAttachments.name,
						desc: SETTING_META.copyAttachments.desc,
						aliases: [...SETTING_META.copyAttachments.aliases],
						control: {
							type: "toggle",
							key: "copyAttachments",
							defaultValue: DEFAULT_SETTINGS.copyAttachments,
						},
					},
					{
						name: SETTING_META.overwriteExisting.name,
						desc: SETTING_META.overwriteExisting.desc,
						aliases: [...SETTING_META.overwriteExisting.aliases],
						control: {
							type: "toggle",
							key: "overwriteExisting",
							defaultValue: DEFAULT_SETTINGS.overwriteExisting,
						},
					},
				],
			},
		];
	}

	getControlValue(key: string): unknown {
		if (key === "defaultProfile") {
			// The stored value may be "pdf" while the mobile dropdown omits it;
			// surface the same fallback the legacy display() shows.
			return resolveSupportedProfile(
				this.plugin.settings.defaultProfile,
				Platform.isDesktopApp,
			);
		}
		return (this.plugin.settings as Record<string, unknown>)[key];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (!(key in SETTING_META)) return;
		if (key === "defaultProfile") {
			const allowed = getAvailableProfiles(Platform.isDesktopApp);
			if (typeof value !== "string" || !allowed.includes(value as ExportProfileId)) {
				return;
			}
		}
		(this.plugin.settings as Record<string, unknown>)[key] = value;
		await this.plugin.saveSettings();
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const debouncedSaveOutputFolder = debounce(async (v: string) => {
			this.plugin.settings.defaultOutputFolder = v;
			await this.plugin.saveSettings();
		}, 500, true);

		// Output folder — most important setting, shown first
		new Setting(containerEl)
			.setName(SETTING_META.defaultOutputFolder.name)
			.setDesc(SETTING_META.defaultOutputFolder.desc)
			.addText((text) => {
				text.setPlaceholder("Exports");
				text.setValue(this.plugin.settings.defaultOutputFolder);
				text.onChange((v) => {
					debouncedSaveOutputFolder(v);
				});
			});

		new Setting(containerEl)
			.setName(SETTING_META.defaultProfile.name)
			.setDesc(SETTING_META.defaultProfile.desc)
			.addDropdown((dd) => {
				for (const profile of getAvailableProfiles(Platform.isDesktopApp)) {
					dd.addOption(profile, PROFILE_LABELS[profile]);
				}
				dd.setValue(resolveSupportedProfile(
					this.plugin.settings.defaultProfile,
					Platform.isDesktopApp,
				));
				dd.onChange(async (v) => {
					this.plugin.settings.defaultProfile = v as ExportProfileId;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl).setName("Advanced").setHeading();

		new Setting(containerEl)
			.setName(SETTING_META.includeSourcePathComments.name)
			.setDesc(SETTING_META.includeSourcePathComments.desc)
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.includeSourcePathComments);
				toggle.onChange(async (v) => {
					this.plugin.settings.includeSourcePathComments = v;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(SETTING_META.copyAttachments.name)
			.setDesc(SETTING_META.copyAttachments.desc)
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.copyAttachments);
				toggle.onChange(async (v) => {
					this.plugin.settings.copyAttachments = v;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(SETTING_META.overwriteExisting.name)
			.setDesc(SETTING_META.overwriteExisting.desc)
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.overwriteExisting);
				toggle.onChange(async (v) => {
					this.plugin.settings.overwriteExisting = v;
					await this.plugin.saveSettings();
				});
			});
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/settings/settings-tab.test.ts
```

Expected: PASS (10 tests).

- [ ] **Step 5: Verify type check and build**

```bash
npx tsc -noEmit -skipLibCheck && npm run build
```

Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add src/settings/settings-tab.ts src/settings/settings-tab.test.ts
git commit -m "feat: expose settings to Obsidian 1.13+ settings search"
```

---

### Task 3: Clear the remaining lint warnings in the test file

`eslint-plugin-obsidianmd@0.4.1` also reports 4 auto-fixable `prefer-create-el` warnings in `src/ui/ProgressNotice.test.ts` (test-only code; the scorecard issue obsidianmd/eslint-plugin#178 tracks this noise). They are trivially fixable, so clear them while we are here.

**Files:**
- Modify: `src/ui/ProgressNotice.test.ts` (via `eslint --fix`)

- [ ] **Step 1: Auto-fix the warnings**

```bash
npx eslint src/ui/ProgressNotice.test.ts --fix
```

- [ ] **Step 2: Run the affected tests**

```bash
npx vitest run src/ui/ProgressNotice.test.ts
```

Expected: PASS. If any test breaks after the fix (e.g. the jsdom polyfill doesn't cover `activeWindow.createDiv`), revert this file with `git checkout -- src/ui/ProgressNotice.test.ts` — the warnings are test-file-only and do not fail CI — and note it in the PR description instead.

- [ ] **Step 3: Commit (skip if reverted)**

```bash
git add src/ui/ProgressNotice.test.ts
git commit -m "style: use createEl helpers in ProgressNotice tests"
```

---

### Task 4: Lint verification and docs

**Files:**
- Modify: `README.md` (one line under the Settings section)

- [ ] **Step 1: Run the full lint and confirm zero warnings**

```bash
npm run lint:obsidian-warnings
```

Expected: no output at all (0 warnings, 0 errors). Specifically, no `settings-tab/prefer-setting-definitions` warning for `src/settings/settings-tab.ts`.

- [ ] **Step 2: Document searchability**

In `README.md`, directly above the settings table (before the `| Setting | Description | Default |` line), add:

```markdown
All settings are indexed and searchable from Obsidian's settings search (Obsidian 1.13+).
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: note settings search support"
```

---

### Task 5: Full verification and release

- [ ] **Step 1: Run the complete CI matrix locally**

```bash
npm run check:version && npm run lint:obsidian-warnings && npx tsc -noEmit -skipLibCheck && npm run build && npm test
```

Expected: all steps pass.

- [ ] **Step 2: Manual smoke test in Obsidian**

The repo root is symlinked into `~/.obsidian/plugins/document-exporter/` (see CLAUDE.md), so after `npm run build`:
1. Reload Obsidian (or toggle the plugin off/on).
2. Open Settings → Document Exporter — legacy UI must render identically to 0.4.10.
3. On Obsidian 1.13+: search "output folder", "word", "attachments" in the settings search bar — Document Exporter entries must appear and navigate to the tab.
4. Change a setting via search navigation; verify it persists after reload (check `data.json`).

- [ ] **Step 3: Bump the version inside the PR**

`check-version.mjs` requires the release tag to equal `package.json`/`manifest.json`/`versions.json`, so the bump must land in the PR — not at tag time. `--no-git-tag-version` keeps npm from creating its own commit/tag (the tag must point at the merged `main` commit), while the `"version"` lifecycle script still runs `version-bump.mjs`, which updates and stages `manifest.json` + `versions.json`:

```bash
npm version 0.5.0 --no-git-tag-version
git add package.json package-lock.json   # manifest.json + versions.json already staged by the version script
git commit -m "chore: bump version to 0.5.0"
```

- [ ] **Step 4: Release (per CLAUDE.md, tag-triggered CI)**

```bash
git checkout -b feat/declarative-settings
# (tasks above were committed on this branch)
git push -u origin feat/declarative-settings
# open PR, get review, merge to main
git checkout main && git pull
git tag -a 0.5.0
git push origin 0.5.0   # CI creates the release; do NOT run gh release create
```

---

## Self-Review Notes

- Spec coverage: scorecard warning (Tasks 2+4), 1.13+ search indexing (Task 2), legacy rendering preserved (Task 2 `display()`), dev-dep upgrade (Task 1), lint clean (Tasks 3+4), mobile-safe initial dropdown value (Task 2 `getControlValue` normalization + test), version metadata before tagging (Task 5).
- Review-driven revisions: `getControlValue` now routes `defaultProfile` through `resolveSupportedProfile` so a stored `pdf` value doesn't feed a mobile dropdown that omits it; the release flow bumps version inside the PR because `scripts/check-version.mjs:17-19` fails any tag that doesn't match `package.json`.
- The `SettingDefinitionItem` union allows `SettingDefinitionGroup` with `type: "group"` + `heading` + `items` — matches the Advanced section. `aliases` lives on `SettingDefinitionBase`, inherited by all item kinds.
- `SettingKey` is currently unused by runtime code (only documents the valid key set used by `setControlValue`'s `key in SETTING_META` guard) — intentional; remove it if lint complains.
