// @ts-nocheck
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

function extendElement(el: HTMLElement): HTMLElement {
	el.empty = () => { el.innerHTML = ""; };
	el.createDiv = (opts?: { cls?: string; text?: string }) => {
		const div = extendElement(activeDocument.createElement("div"));
		if (opts?.cls) div.classList.add(...opts.cls.split(" "));
		if (opts?.text) div.textContent = opts.text;
		el.appendChild(div);
		return div;
	};
	el.createSpan = (opts?: { text?: string }) => {
		const span = extendElement(activeDocument.createElement("span"));
		if (opts?.text) span.textContent = opts.text;
		el.appendChild(span);
		return span;
	};
	el.createEl = (tag: string, opts?: { text?: string; cls?: string }) => {
		const child = extendElement(activeDocument.createElement(tag));
		if (opts?.text) child.textContent = opts.text;
		if (opts?.cls) child.classList.add(...opts.cls.split(" "));
		el.appendChild(child);
		return child;
	};
	return el;
}

const noticeInstances: { noticeEl: HTMLElement; message: string }[] = [];

vi.mock("obsidian", () => ({
	Notice: class {
		message: string;
		timeout: number;
		noticeEl: HTMLElement;
		constructor(message: string, timeout: number) {
			this.message = message;
			this.timeout = timeout;
			this.noticeEl = extendElement(activeDocument.createElement("div"));
			noticeInstances.push({ noticeEl: this.noticeEl, message });
		}
		setMessage(msg: string) { this.message = msg; }
		hide() { this.noticeEl.remove(); }
	},
}));

import { ProgressNotice } from "@/ui/ProgressNotice";

function lastNotice() {
	return noticeInstances[noticeInstances.length - 1];
}

describe("ProgressNotice", () => {
	beforeEach(() => {
		Object.defineProperty(window, "activeDocument", {
			value: window.document,
			configurable: true,
		});
		Object.defineProperty(activeDocument, "hasFocus", {
			value: () => true,
			configurable: true,
		});
		noticeInstances.length = 0;
		delete window.Notification;
	});

	it("shows notice on start with title", () => {
		const p = new ProgressNotice("Exporting: test");
		p.start(10);
		expect(lastNotice().noticeEl.querySelector(".de-progress-title")?.textContent).toBe("Exporting: test");
	});

	it("renders progress bar elements", () => {
		const p = new ProgressNotice("Test");
		p.start(5);
		const el = lastNotice().noticeEl;
		expect(el.querySelector(".de-progress-bar")).toBeTruthy();
		expect(el.querySelector(".de-progress-fill")).toBeTruthy();
		expect(el.querySelector(".de-progress-cancel")).toBeTruthy();
	});

	it("updates fill width on setProgress", () => {
		const p = new ProgressNotice("Test");
		p.start(10);
		p.setProgress(5, 10);
		const fill = lastNotice().noticeEl.querySelector(".de-progress-fill") as HTMLElement;
		expect(fill.style.width).toBe("50%");
	});

	it("updates phase text on setPhase", () => {
		const p = new ProgressNotice("Test");
		p.start(5);
		p.setPhase("Rendering output");
		expect(lastNotice().noticeEl.querySelector(".de-progress-phase span")?.textContent).toBe("Rendering output");
	});

	it("calls onCancel when cancel button clicked", () => {
		const p = new ProgressNotice("Test");
		p.start(5);
		const spy = vi.fn();
		p.onCancel = spy;
		(lastNotice().noticeEl.querySelector(".de-progress-cancel") as HTMLButtonElement).click();
		expect(spy).toHaveBeenCalledOnce();
	});

	it("disables cancel button after click", () => {
		const p = new ProgressNotice("Test");
		p.start(5);
		p.onCancel = vi.fn();
		const btn = lastNotice().noticeEl.querySelector(".de-progress-cancel") as HTMLButtonElement;
		btn.click();
		expect(btn.disabled).toBe(true);
		expect(btn.textContent).toBe("Cancelling...");
	});

	it("hides notice on finish", () => {
		const p = new ProgressNotice("Test");
		p.start(5);
		const notice = lastNotice();
		p.finish("Done");
		expect(notice.noticeEl.parentElement).toBeNull();
	});

	it("sends a system notification on finish when Obsidian is not focused", () => {
		const notify = vi.fn();
		window.Notification = vi.fn(function (title: string, options: { body?: string }) {
			notify(title, options);
		});
		window.Notification.permission = "granted";
		Object.defineProperty(activeDocument, "hasFocus", {
			value: () => false,
			configurable: true,
		});

		const p = new ProgressNotice("Exporting: test");
		p.start(5);
		p.finish("Export complete: out");

		expect(notify).toHaveBeenCalledWith("Document Exporter", {
			body: "Export complete: out",
		});
	});

	it("falls back to Electron notifications when web notifications are not granted", () => {
		const notify = vi.fn();
		window.Notification = { permission: "default" };
		window.require = vi.fn((moduleId: string) => {
			if (moduleId !== "electron") return undefined;
			function TestNotification(options: { title: string; body?: string }): { show: () => void } {
				notify(options);
				return { show: vi.fn() };
			}
			return {
				remote: {
					Notification: TestNotification,
				},
			};
		});
		Object.defineProperty(activeDocument, "hasFocus", {
			value: () => false,
			configurable: true,
		});

		const p = new ProgressNotice("Exporting: test");
		p.start(5);
		p.finish("Export complete: out");

		expect(notify).toHaveBeenCalledWith({
			title: "Document Exporter",
			body: "Export complete: out",
		});
	});

	it("increments progress bar on increment", () => {
		const p = new ProgressNotice("Test");
		p.start(4);
		p.increment();
		p.increment();
		expect((lastNotice().noticeEl.querySelector(".de-progress-fill") as HTMLElement).style.width).toBe("50%");
	});

	it("updates title dynamically", () => {
		const p = new ProgressNotice("Old");
		p.start(5);
		p.setTitle("New title");
		expect(lastNotice().noticeEl.querySelector(".de-progress-title")?.textContent).toBe("New title");
	});
});
