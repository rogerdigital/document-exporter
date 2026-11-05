import { Platform } from "obsidian";

/** Resolve input once, before path classification or plan construction. */
export function normalizeOutputFolder(value: string): string {
	let path = value.trim().replace(/\\/g, "/");
	if (path === "~" || path.startsWith("~/")) {
		if (Platform.isDesktop && Platform.isDesktopApp) {
			const g = typeof window !== "undefined" ? window : undefined;
			const require = g && "require" in g
				? (g as unknown as Record<string, (id: string) => unknown>)["require"] : undefined;
			if (!require) throw new Error("Cannot resolve the home folder. Choose an absolute output folder.");
			const home = (require("os") as { homedir(): string }).homedir().replace(/\\/g, "/");
			path = home + path.slice(1);
		} else {
			throw new Error("Home paths require the desktop app. Use a vault-relative folder.");
		}
	} else if (/^(~|%|\$)/.test(path) || /^[A-Za-z]:(?!\/)/.test(path)) {
		throw new Error("Unsupported system path. Choose a folder or enter an absolute path.");
	}
	if (Array.from(path).some(character => character.charCodeAt(0) < 32)) throw new Error("Output folder contains invalid path characters.");
	// Preserve filesystem roots, including C:/ and UNC's leading //.
	if (/^[A-Za-z]:\/$/.test(path)) return path;
	return path.replace(/\/+$/, "") || (path.startsWith("/") ? "/" : "");
}

