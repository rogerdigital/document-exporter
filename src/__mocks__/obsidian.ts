export class TFile {
	path = "";
	basename = "";
	extension = "";
	name = "";
}

export class TFolder {
	path = "";
	name = "";
	children: unknown[] = [];
}

export class TAbstractFile {
	path = "";
	name = "";
}

export const Platform = {
	isMobile: false,
	isDesktopApp: true,
	isDesktop: true,
};

export class FileSystemAdapter {
	getBasePath(): string {
		return "/mock-vault";
	}
}

export class App {}
export class Modal {}
export class Plugin {}
export class PluginSettingTab {}
export class Setting {}
export class Notice {}
export class FuzzySuggestModal {}

export function parseLinktext(linktext: string): { path: string; subpath: string } {
	const index = linktext.indexOf("#");
	if (index === -1) return { path: linktext, subpath: "" };
	return { path: linktext.slice(0, index), subpath: linktext.slice(index) };
}

export function resolveSubpath(cache: unknown, subpath: string): unknown {
	return (cache as Record<string, unknown> | null)?.[subpath] ?? null;
}
