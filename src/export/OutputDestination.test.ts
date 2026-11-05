import { Platform } from 'obsidian';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { resolveOutputPlan } from '@/export/OutputDestination';
import { normalizeOutputFolder } from '@/export/OutputPath';
import { ExportPlanBuilder } from '@/export/ExportPlan';
import { OutputWriter } from '@/export/OutputWriter';
import { DEFAULT_SETTINGS } from '@/types';
import { createMemoryVault } from '@/test-support/memory-vault';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('output destinations', () => {
	it('normalizes pasted absolute paths and preserves vault paths', () => {
		expect(normalizeOutputFolder(' /Users/test/Downloads/ ')).toBe('/Users/test/Downloads');
		expect(normalizeOutputFolder('Exports')).toBe('Exports');
		expect(normalizeOutputFolder('C:\\Users\\test\\Downloads\\')).toBe('C:/Users/test/Downloads');
		expect(normalizeOutputFolder('/')).toBe('/');
		expect(normalizeOutputFolder('C:\\')).toBe('C:/');
	});
	it('expands home shorthand without silently treating it as a vault folder', () => {
		vi.stubGlobal('window', { require: () => ({ homedir: () => '/Users/test' }) });
		expect(normalizeOutputFolder('~/Downloads')).toBe('/Users/test/Downloads');
		expect(() => normalizeOutputFolder('~other/Downloads')).toThrow();
		expect(() => normalizeOutputFolder('%USERPROFILE%/Downloads')).toThrow();
	});
	it('reuses an empty destination and keeps conflicting exports inside it', async () => {
		const f = createMemoryVault();
		await f.app.vault.createFolder('Exports');
		const plan = new ExportPlanBuilder(f.app, { type: 'current-file', path: 'note.md' }, 'markdown-bundle', 'Exports', 'note').setInputFiles(['note.md']).build();
		const writer = new OutputWriter(f.app);
		const settings = { ...DEFAULT_SETTINGS, overwriteExisting: false };
		expect(resolveOutputPlan(plan, settings, writer).outputRoot).toBe('Exports');
		f.putText('Exports/unrelated.md', 'unrelated');
		expect(resolveOutputPlan(plan, settings, writer).outputRoot).toBe('Exports');
		f.putText('Exports/note.md', 'previous');
		const resolved = resolveOutputPlan(plan, settings, writer);
		expect(resolved.outputRoot).toMatch(/^Exports\/note-/);
		expect(resolveOutputPlan(resolved, settings, writer)).toEqual(resolved);
		expect(f.text('Exports/note.md')).toBe('previous');
	});
	it('rejects a file occupying the selected parent directory', () => {
		const f = createMemoryVault(); f.putText('Exports', 'keep');
		const plan = new ExportPlanBuilder(f.app, { type: 'current-file', path: 'note.md' }, 'markdown-bundle', 'Exports', 'note').setInputFiles(['note.md']).build();
		expect(() => resolveOutputPlan(plan, DEFAULT_SETTINGS, new OutputWriter(f.app))).toThrow('not a folder');
	});
});

it('writes normalized home paths to the real filesystem and preserves earlier exports', async () => {
	const fs = await import('node:fs');
	const { createRequire } = await import('node:module');
	const os = await import('node:os');
	const path = await import('node:path');
	const base = fs.mkdtempSync(path.join(os.tmpdir(), 'issue100-regression-')).replace(/\\/g, '/');
	const require = createRequire(import.meta.url);
	vi.stubGlobal('window', { require: (id: string) => id === 'os' ? { homedir: () => base } : require(id) as unknown });
	vi.resetModules();
	try {
		const { ExportRunner } = await import('@/export/ExportRunner');
		const { ExportPlanBuilder: Builder } = await import('@/export/ExportPlan');
		const { createMemoryVault: freshVault } = await import('@/test-support/memory-vault');
		const f = freshVault();
		f.putText('note.md', '# External path regression\n![[image.png]]');
		f.putBinary('image.png', new Uint8Array([1, 2, 3]));
		fs.mkdirSync(`${base}/Downloads`);
		const plan = new Builder(f.app, { type: 'current-file', path: 'note.md' }, 'markdown-bundle', ' ~/Downloads/ ', 'note').setInputFiles(['note.md']).build();
		const settings = { ...DEFAULT_SETTINGS, copyAttachments: true, expandEmbeds: false, overwriteExisting: false };
		const first = await new ExportRunner(f.app).run(plan, settings);
		expect(first.status).toBe('completed');
		expect(first.outputRoot).toBe(`${base}/Downloads`);
		const original = fs.readFileSync(first.completedPaths[0], 'utf8');
		expect(original).toContain('External path regression');
		expect([...fs.readFileSync(`${first.outputRoot}/assets/image.png`)]).toEqual([1, 2, 3]);
		const second = await new ExportRunner(f.app).run(plan, settings);
		expect(second.status).toBe('completed');
		expect(second.outputRoot.startsWith(`${base}/Downloads/note-`)).toBe(true);
		expect(fs.readFileSync(first.completedPaths[0], 'utf8')).toBe(original);
		expect([...fs.readFileSync(`${second.outputRoot}/assets/image.png`)]).toEqual([1, 2, 3]);
		expect(f.paths()).not.toContain('~/Downloads/note.md');
		fs.writeFileSync(`${base}/blocked`, 'keep');
		const blocked = new Builder(f.app, { type: 'current-file', path: 'note.md' }, 'markdown-bundle', `${base}/blocked`, 'note').setInputFiles(['note.md']).build();
		const failed = await new ExportRunner(f.app).run(blocked, settings);
		expect(failed.status).toBe('failed');
		expect(failed.errors.join(' ')).toContain('not a folder');
		expect(fs.readFileSync(`${base}/blocked`, 'utf8')).toBe('keep');
	} finally {
		fs.rmSync(base, { recursive: true, force: true });
		vi.resetModules();
	}
});

it('rejects unresolved home paths and protects the mobile vault', async () => {
	vi.stubGlobal('window', {});
	expect(() => normalizeOutputFolder('~/Downloads')).toThrow('Cannot resolve');
	const desktop = Platform.isDesktopApp;
	try {
		Platform.isDesktopApp = false;
		expect(() => normalizeOutputFolder('~/Downloads')).toThrow('desktop app');
	} finally { Platform.isDesktopApp = desktop; }
});
