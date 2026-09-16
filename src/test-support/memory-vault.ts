import { TFile, TFolder } from "obsidian";
import { normalizePath } from "@/export/utils";

export type StoredContent = string | ArrayBuffer;

// In-memory vault that persists writes across runs so integration tests can
// detect corruption between sequential exports. Test support only — the
// metadata cache implements just the literal wiki-link syntax put into the
// fixture; heading/block resolution belongs to real Obsidian (see the 1.0.0
// acceptance protocol).
export interface MemoryVaultFixture {
	app: import("obsidian").App;
	putText(path: string, text: string): TFile;
	putBinary(path: string, bytes: Uint8Array): TFile;
	text(path: string): string;
	bytes(path: string): Uint8Array;
	paths(): string[];
	remove(path: string): void;
}

interface FolderNode extends TFolder {
	children: (TFile | FolderNode)[];
}

const WIKI_LINK_RE = /(?<!!)\[\[([^\]]+)]]/g;
const WIKI_EMBED_RE = /!\[\[([^\]]+)]]/g;

export function createMemoryVault(): MemoryVaultFixture {
	const nodes = new Map<string, TFile | FolderNode>();
	const contents = new Map<string, StoredContent>();
	const root: FolderNode = Object.assign(new TFolder(), {
		path: "",
		name: "",
		children: [],
	});

	function basename(path: string): string {
		return path.split("/").pop() ?? path;
	}

	function makeFile(path: string): TFile {
		const name = basename(path);
		const file = new TFile();
		file.path = path;
		file.name = name;
		file.basename = name.replace(/\.[^.]+$/, "");
		file.extension = name.includes(".") ? name.split(".").pop()! : "";
		return file;
	}

	function makeFolder(path: string): FolderNode {
		return Object.assign(new TFolder(), { path, name: basename(path), children: [] });
	}

	function parentFolder(path: string): FolderNode {
		const separator = path.lastIndexOf("/");
		return separator === -1 ? root : ensureFolder(path.slice(0, separator));
	}

	function ensureFolder(path: string): FolderNode {
		const normalized = normalizePath(path);
		if (!normalized) return root;
		const existing = nodes.get(normalized);
		if (existing) {
			if ("children" in existing) return existing;
			throw new Error(`Folder path is occupied by a file: ${normalized}`);
		}
		const folder = makeFolder(normalized);
		nodes.set(normalized, folder);
		parentFolder(normalized).children.push(folder);
		return folder;
	}

	function registerFile(path: string, content: StoredContent): TFile {
		const normalized = normalizePath(path);
		if (!normalized) throw new Error("File path cannot be empty");
		if (nodes.has(normalized)) throw new Error(`File already exists: ${normalized}`);
		const file = makeFile(normalized);
		nodes.set(normalized, file);
		contents.set(normalized, content);
		parentFolder(normalized).children.push(file);
		return file;
	}

	function requireFile(path: string): TFile {
		const node = nodes.get(normalizePath(path));
		if (!node || !("extension" in node)) {
			throw new Error(`File not found: ${path}`);
		}
		return node;
	}

	function cloneBuffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
		const view = data instanceof Uint8Array ? data : new Uint8Array(data);
		const buffer = new ArrayBuffer(view.byteLength);
		new Uint8Array(buffer).set(view);
		return buffer;
	}

	const vault = {
		getAbstractFileByPath: (path: string): TFile | TFolder | null => {
			const normalized = normalizePath(path);
			if (!normalized) return root;
			return nodes.get(normalized) ?? null;
		},
		read: async (file: TFile): Promise<string> => {
			const content = contents.get(requireFile(file.path).path);
			if (typeof content !== "string") {
				throw new Error(`Not a text file: ${file.path}`);
			}
			return content;
		},
		readBinary: async (file: TFile): Promise<ArrayBuffer> => {
			const content = contents.get(requireFile(file.path).path);
			if (!(content instanceof ArrayBuffer)) {
				throw new Error(`Not a binary file: ${file.path}`);
			}
			return cloneBuffer(content);
		},
		createFolder: async (path: string): Promise<TFolder> => {
			const normalized = normalizePath(path);
			if (!normalized) throw new Error("Folder path cannot be empty");
			if (nodes.has(normalized)) throw new Error(`Folder already exists: ${normalized}`);
			return ensureFolder(normalized);
		},
		create: async (path: string, content: string): Promise<TFile> => {
			const normalized = normalizePath(path);
			if (nodes.has(normalized)) throw new Error(`File already exists: ${normalized}`);
			return registerFile(normalized, content);
		},
		modify: async (file: TFile, content: string): Promise<void> => {
			const normalized = requireFile(file.path).path;
			if (typeof contents.get(normalized) !== "string") {
				throw new Error(`Not a text file: ${normalized}`);
			}
			contents.set(normalized, content);
		},
		createBinary: async (path: string, data: ArrayBuffer): Promise<TFile> => {
			const normalized = normalizePath(path);
			if (nodes.has(normalized)) throw new Error(`File already exists: ${normalized}`);
			return registerFile(normalized, cloneBuffer(data));
		},
		modifyBinary: async (file: TFile, data: ArrayBuffer): Promise<void> => {
			const normalized = requireFile(file.path).path;
			if (!(contents.get(normalized) instanceof ArrayBuffer)) {
				throw new Error(`Not a binary file: ${normalized}`);
			}
			contents.set(normalized, cloneBuffer(data));
		},
		getMarkdownFiles: (): TFile[] =>
			[...nodes.values()].filter(
				(node): node is TFile => "extension" in node && node.extension === "md",
			),
	};

	function parseCache(text: string): {
		frontmatter: Record<string, unknown>;
		links: { link: string }[];
		embeds: { link: string }[];
	} {
		const body = text.replace(/^---\r?\n(?:[\s\S]*?\r?\n)?---(?:\r?\n|$)/, "");
		const links: { link: string }[] = [];
		for (const match of body.matchAll(WIKI_LINK_RE)) {
			links.push({ link: match[1].split("|")[0].split("#")[0] });
		}
		const embeds: { link: string }[] = [];
		for (const match of body.matchAll(WIKI_EMBED_RE)) {
			embeds.push({ link: match[1].split("|")[0].split("#")[0] });
		}
		const frontmatter: Record<string, unknown> = {};
		const fm = text.match(/^---\r?\n((?:[\s\S]*?\r?\n)?)---(?:\r?\n|$)/);
		if (fm) {
			for (const line of fm[1].split(/\r?\n/)) {
				const colon = line.indexOf(":");
				if (colon > 0) frontmatter[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
			}
		}
		return { frontmatter, links, embeds };
	}

	const metadataCache = {
		getFileCache: (file: TFile): Record<string, unknown> | null => {
			const content = contents.get(requireFile(file.path).path);
			if (typeof content !== "string") return null;
			return parseCache(content);
		},
		getFirstLinkpathDest: (linkpath: string, sourcePath: string): TFile | null => {
			const target = normalizePath(linkpath.split("#")[0].split("|")[0]);
			if (!target) return null;
			const separator = sourcePath.lastIndexOf("/");
			const dir = separator === -1 ? "" : sourcePath.slice(0, separator);
			const candidates = dir ? [`${dir}/${target}`, target] : [target];
			for (const candidate of candidates) {
				const withExtension = candidate.toLowerCase().endsWith(".md")
					? candidate
					: `${candidate}.md`;
				const hit = nodes.get(candidate) ?? nodes.get(withExtension);
				if (hit && "extension" in hit) return hit;
			}
			return null;
		},
	};

	return {
		app: { vault, metadataCache } as unknown as import("obsidian").App,
		putText: (path, text) => registerFile(path, text),
		putBinary: (path, bytes) => registerFile(path, cloneBuffer(bytes)),
		text: (path) => {
			const content = contents.get(requireFile(path).path);
			if (typeof content !== "string") throw new Error(`Not a text file: ${path}`);
			return content;
		},
		bytes: (path) => {
			const content = contents.get(requireFile(path).path);
			if (!(content instanceof ArrayBuffer)) throw new Error(`Not a binary file: ${path}`);
			return new Uint8Array(cloneBuffer(content));
		},
		paths: () => [...nodes.keys()].sort(),
		remove: (path) => {
			const normalized = normalizePath(path);
			const node = nodes.get(normalized);
			if (!node) throw new Error(`File not found: ${path}`);
			nodes.delete(normalized);
			contents.delete(normalized);
			const parent = parentFolder(normalized);
			parent.children = parent.children.filter((child) => child !== node);
		},
	};
}
