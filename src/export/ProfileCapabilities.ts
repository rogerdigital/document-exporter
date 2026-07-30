import { ExportProfileId } from "@/types";

const ALL_PROFILES: ExportProfileId[] = [
	"pdf",
	"docx",
	"markdown-bundle",
	"html-document",
];

export function isProfileSupported(
	profile: ExportProfileId,
	isDesktopApp: boolean,
): boolean {
	return profile !== "pdf" || isDesktopApp;
}

export function getAvailableProfiles(isDesktopApp: boolean): ExportProfileId[] {
	return ALL_PROFILES.filter((profile) => isProfileSupported(profile, isDesktopApp));
}

export function resolveSupportedProfile(
	profile: ExportProfileId,
	isDesktopApp: boolean,
): ExportProfileId {
	return isProfileSupported(profile, isDesktopApp) ? profile : "markdown-bundle";
}
