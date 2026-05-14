import { App, Component, MarkdownRenderer } from "obsidian";
import { AttachmentCopy } from "@/types";

export interface NativeRenderResult {
	html: string;
	warnings: string[];
}

const POST_PROCESSOR_TIMEOUT = 5000;
const DEBOUNCE_INTERVAL = 200;

export async function renderMarkdownNative(
	app: App,
	markdown: string,
	sourcePath: string,
	timeout = POST_PROCESSOR_TIMEOUT,
): Promise<NativeRenderResult> {
	const warnings: string[] = [];
	const container = document.body.createDiv();
	container.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:800px;visibility:hidden;";

	const component = new Component();
	component.load();

	try {
		await MarkdownRenderer.render(app, markdown, container, sourcePath, component);
		const completed = await waitForPostProcessors(container, timeout);
		if (!completed) {
			warnings.push(`Post-processor timeout for "${sourcePath}" — some content may be incomplete`);
		}
		const html = container.innerHTML;
		return { html, warnings };
	} finally {
		component.unload();
		container.remove();
	}
}

export function extractObsidianStyles(): string {
	const sheets: string[] = [];
	for (let i = 0; i < document.styleSheets.length; i++) {
		const sheet = document.styleSheets[i];
		try {
			for (let j = 0; j < sheet.cssRules.length; j++) {
				const rule = sheet.cssRules[j];
				const text = rule.cssText;
				if (shouldIncludeRule(text)) {
					sheets.push(text);
				}
			}
		} catch {
			// Cross-origin stylesheet, skip
		}
	}
	return sheets.join("\n");
}

const EXCLUDED_PREFIXES = [
	".cm-",
	".ͼ",
	".CodeMirror",
	".workspace-",
	".mod-root",
	".mod-left-split",
	".mod-right-split",
	".titlebar",
	".sidebar-toggle",
	".status-bar",
	".nav-header",
	".nav-folder",
	".nav-file",
	".tree-item",
	".menu",
	".modal-container",
	".modal-bg",
	".prompt",
	".suggestion-",
	".setting-item",
	".horizontal-tab",
	".vertical-tab",
	".tooltip",
	".workspace-tab",
	".workspace-leaf",
	".workspace-split",
	".workspace-drawer",
	".view-header",
	".view-action",
];

function shouldIncludeRule(cssText: string): boolean {
	for (const prefix of EXCLUDED_PREFIXES) {
		if (cssText.startsWith(prefix)) return false;
	}
	if (cssText.startsWith("@keyframes cm-blink")) return false;
	return true;
}

export function rewriteAppProtocolUrls(
	html: string,
	attachments: AttachmentCopy[],
): string {
	const attachmentMap = new Map<string, string>();
	for (const att of attachments) {
		const filename = att.sourcePath.split("/").pop() ?? "";
		attachmentMap.set(filename, att.outputRelativePath);
	}

	return html.replace(
		/src="app:\/\/[^"]*\/([^"/?]+)(?:\?[^"]*)?"]/g,
		(match, filename: string) => {
			const decodedName = decodeURIComponent(filename);
			const relPath = attachmentMap.get(decodedName);
			if (relPath) {
				return `src="${relPath}"`;
			}
			return match;
		},
	);
}

async function waitForPostProcessors(
	el: HTMLElement,
	timeout: number,
): Promise<boolean> {
	return new Promise((resolve) => {
		let timer: ReturnType<typeof setTimeout>;
		let overallTimer: ReturnType<typeof setTimeout>;

		const observer = new MutationObserver(() => {
			clearTimeout(timer);
			timer = setTimeout(() => {
				observer.disconnect();
				clearTimeout(overallTimer);
				resolve(true);
			}, DEBOUNCE_INTERVAL);
		});

		observer.observe(el, { childList: true, subtree: true, attributes: true });

		// Initial debounce in case no mutations fire (rendering already complete)
		timer = setTimeout(() => {
			observer.disconnect();
			clearTimeout(overallTimer);
			resolve(true);
		}, DEBOUNCE_INTERVAL);

		// Overall timeout safety net
		overallTimer = setTimeout(() => {
			observer.disconnect();
			clearTimeout(timer);
			resolve(false);
		}, timeout);
	});
}
