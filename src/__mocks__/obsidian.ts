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
