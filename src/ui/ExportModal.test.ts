// @ts-nocheck
/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { defaultMergeFilename, deriveDefaultFilename, ExportModal } from "@/ui/ExportModal";
import { DEFAULT_SETTINGS } from "@/types";

function extendElement(el: HTMLElement): HTMLElement {
	el.empty = () => { el.innerHTML = ""; };
	el.createDiv = (opts?: { cls?: string; text?: string }) => {
		const div = extendElement(document.createElement("div"));
		if (opts?.cls) div.addClass(opts.cls);
		if (opts?.text) div.textContent = opts.text;
		el.appendChild(div);
		return div;
	};
	el.createSpan = (opts?: { text?: string }) => {
		const span = extendElement(document.createElement("span"));
		if (opts?.text) span.textContent = opts.text;
		el.appendChild(span);
		return span;
	};
	el.createEl = (tag: string, opts?: { text?: string; cls?: string; attr?: Record<string, string>; type?: string }) => {
		const child = extendElement(document.createElement(tag));
		if (opts?.text) child.textContent = opts.text;
		if (opts?.cls) child.addClass(opts.cls);
		if (opts?.type) child.type = opts.type;
		if (opts?.attr) for (const [key, value] of Object.entries(opts.attr)) child.setAttribute(key, value);
		el.appendChild(child);
		return child;
	};
	el.addClass = (cls: string) => el.classList.add(...cls.split(" "));
	el.removeClass = (cls: string) => el.classList.remove(cls);
	el.appendText = (text: string) => el.appendChild(document.createTextNode(text));
	return el;
}

function createModal(): ExportModal {
	const app = { workspace: { getActiveFile: vi.fn(() => null) } };
	const modal = new ExportModal(app as never, { ...DEFAULT_SETTINGS } as never);
	modal.contentEl = extendElement(document.createElement("div"));
	return modal;
}

function fileNameInput(modal: ExportModal): HTMLInputElement {
	const inputs = modal.contentEl.querySelectorAll('input[type="text"]');
	return inputs[inputs.length - 1];
}

describe("deriveDefaultFilename", () => {
	it("prefers the context-menu file over the active editor file", () => {
		const activeFile = { path: "active.md", basename: "active", extension: "md" };
		const selectedFile = { path: "selected.md", basename: "selected", extension: "md" };
		const app = {
			workspace: { getActiveFile: vi.fn(() => activeFile) },
		};

		expect(deriveDefaultFilename(app as never, selectedFile as never)).toBe("selected");
	});
});

describe("defaultMergeFilename", () => {
	it("uses the folder leaf for folder sources", () => {
		expect(defaultMergeFilename("folder", "book/part-one")).toBe("part-one");
	});

	it("falls back to merged for the vault root", () => {
		expect(defaultMergeFilename("folder", "")).toBe("merged");
	});

	it("uses merged for selected-files sources", () => {
		expect(defaultMergeFilename("files", "")).toBe("merged");
	});
});

describe("merge file name field", () => {
	it("keeps a customized name when the form re-renders after Back", () => {
		const modal = createModal();
		modal.onOpen();

		const sourceSelect = modal.contentEl.querySelector("select");
		sourceSelect.value = "folder";
		sourceSelect.dispatchEvent(new Event("change"));

		const folderPathInput = modal.contentEl.querySelector('input[type="text"]');
		folderPathInput.value = "book";
		folderPathInput.dispatchEvent(new Event("input"));

		const checkbox = modal.contentEl.querySelector('input[type="checkbox"]');
		checkbox.checked = true;
		checkbox.dispatchEvent(new Event("change"));
		expect(fileNameInput(modal).value).toBe("book");

		fileNameInput(modal).value = "My book";
		fileNameInput(modal).dispatchEvent(new Event("input"));

		// Back from the confirmation page re-renders the whole form.
		modal.onOpen();

		expect(fileNameInput(modal).value).toBe("My book");
	});

	it("reseeds the default when the source changes while merge is on", () => {
		const modal = createModal();
		modal.onOpen();

		const sourceSelect = modal.contentEl.querySelector("select");
		sourceSelect.value = "folder";
		sourceSelect.dispatchEvent(new Event("change"));

		const checkbox = modal.contentEl.querySelector('input[type="checkbox"]');
		checkbox.checked = true;
		checkbox.dispatchEvent(new Event("change"));
		fileNameInput(modal).value = "My book";
		fileNameInput(modal).dispatchEvent(new Event("input"));

		sourceSelect.value = "files";
		sourceSelect.dispatchEvent(new Event("change"));

		expect(fileNameInput(modal).value).toBe("merged");
	});
});
