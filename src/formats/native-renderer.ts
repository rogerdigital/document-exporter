import { App, Component, MarkdownRenderer } from "obsidian";
import { AttachmentCopy } from "@/types";
import { relativePathBetween } from "@/export/utils";

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
	const container = activeDocument.body.createDiv();
	container.setCssProps({
		position: "fixed",
		left: "-9999px",
		top: "-9999px",
		width: "800px",
		visibility: "hidden",
	});

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
	for (let i = 0; i < activeDocument.styleSheets.length; i++) {
		const sheet = activeDocument.styleSheets[i];
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
	return html.replace(/\b(src|href|data)="(app:\/\/[^"]+)"/g, (
		match,
		attribute: string,
		rawUrl: string,
	) => {
		const outputPath = resolveAttachmentUrl(rawUrl, attachments);
		return outputPath ? `${attribute}="${outputPath}"` : match;
	});
}

export function restoreAttachmentSourceUrls(
	markdown: string,
	sourcePath: string,
	attachments: AttachmentCopy[],
): string {
	const restoreUrl = (rawUrl: string): string => {
		const wrapped = rawUrl.startsWith("<") && rawUrl.endsWith(">");
		const url = wrapped ? rawUrl.slice(1, -1) : rawUrl;
		const normalized = url.replace(/^(?:(?:\.\.|\.)\/)+/, "");
		const attachment = attachments.find(
			(candidate) => candidate.outputRelativePath === normalized,
		);
		if (!attachment) return rawUrl;

		const sourceUrl = relativePathBetween(sourcePath, attachment.sourcePath);
		return wrapped ? `<${sourceUrl}>` : sourceUrl;
	};

	const markdownDestination =
		/(!?\[[^\]]*]\(\s*)(<[^>]+>|[^)\s]+)(?=(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\))/g;
	const withMarkdownUrls = markdown.replace(
		markdownDestination,
		(_match, prefix: string, rawUrl: string) => `${prefix}${restoreUrl(rawUrl)}`,
	);

	return withMarkdownUrls.replace(
		/(\b(?:src|href|data)=["'])([^"']+)(["'])/g,
		(_match, prefix: string, rawUrl: string, suffix: string) => {
			return `${prefix}${restoreUrl(rawUrl)}${suffix}`;
		},
	);
}

function resolveAttachmentUrl(
	rawUrl: string,
	attachments: AttachmentCopy[],
): string | null {
	let decodedPath: string;
	try {
		decodedPath = decodeURIComponent(new URL(rawUrl).pathname)
			.replace(/^\/+/, "");
	} catch {
		return null;
	}

	const exact = attachments.find((attachment) => {
		return decodedPath === attachment.sourcePath
			|| decodedPath.endsWith(`/${attachment.sourcePath}`);
	});
	if (exact) return exact.outputRelativePath;

	const basename = decodedPath.split("/").pop() ?? "";
	const matches = attachments.filter((attachment) => {
		return attachment.sourcePath.split("/").pop() === basename;
	});
	return matches.length === 1 ? matches[0].outputRelativePath : null;
}

async function waitForPostProcessors(
	el: HTMLElement,
	timeout: number,
): Promise<boolean> {
	return new Promise((resolve) => {
		let timer: number | undefined;
		let overallTimer: number | undefined;

		const clearTimer = (timerId: number | undefined) => {
			if (timerId !== undefined) {
				window.clearTimeout(timerId);
			}
		};

		const observer = new MutationObserver(() => {
			clearTimer(timer);
			timer = window.setTimeout(() => {
				observer.disconnect();
				clearTimer(overallTimer);
				resolve(true);
			}, DEBOUNCE_INTERVAL);
		});

		observer.observe(el, { childList: true, subtree: true, attributes: true });

		// Initial debounce in case no mutations fire (rendering already complete)
		timer = window.setTimeout(() => {
			observer.disconnect();
			clearTimer(overallTimer);
			resolve(true);
		}, DEBOUNCE_INTERVAL);

		// Overall timeout safety net
		overallTimer = window.setTimeout(() => {
			observer.disconnect();
			clearTimer(timer);
			resolve(false);
		}, timeout);
	});
}
