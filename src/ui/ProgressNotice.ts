import { Notice } from "obsidian";

const PROGRESS_BAR_CLASS = "de-progress-bar";
const PROGRESS_FILL_CLASS = "de-progress-fill";
const PROGRESS_PCT_CLASS = "de-progress-pct";
const PROGRESS_TITLE_CLASS = "de-progress-title";
const PROGRESS_PHASE_CLASS = "de-progress-phase";
const PROGRESS_CANCEL_CLASS = "de-progress-cancel";

export class ProgressNotice {
	private notice: Notice | null = null;
	private title = "";
	private count = 0;
	private total = 0;
	private phase = "";
	onCancel: (() => void) | null = null;

	private titleEl: HTMLElement | null = null;
	private fillEl: HTMLElement | null = null;
	private pctEl: HTMLElement | null = null;
	private phaseEl: HTMLElement | null = null;

	constructor(title: string) {
		this.title = title;
	}

	start(total: number): void {
		this.total = total;
		this.count = 0;
		this.phase = "";
		this.show();
	}

	setTitle(title: string): void {
		this.title = title;
		if (this.titleEl) this.titleEl.textContent = title;
	}

	setProgress(current: number, total: number): void {
		this.count = current;
		this.total = total;
		this.updateBar();
	}

	setPhase(phase: string): void {
		this.phase = phase;
		if (this.phaseEl) this.phaseEl.textContent = phase;
	}

	increment(): void {
		this.count++;
		this.updateBar();
	}

	finish(finalMessage: string): void {
		this.notice?.hide();
		this.notice = null;
		this.titleEl = null;
		this.fillEl = null;
		this.pctEl = null;
		this.phaseEl = null;
		new Notice(finalMessage, 5000);
	}

	private show(): void {
		if (this.notice) {
			this.notice.hide();
		}
		this.notice = new Notice("", 0);
		const noticeEl = (this.notice as unknown as { noticeEl: HTMLElement }).noticeEl;
		noticeEl.empty();
		noticeEl.classList.add("de-progress-notice");

		const content = noticeEl.createDiv({ cls: "de-progress-content" });

		this.titleEl = content.createDiv({ cls: PROGRESS_TITLE_CLASS, text: this.title });

		const barContainer = content.createDiv({ cls: PROGRESS_BAR_CLASS });
		this.fillEl = barContainer.createDiv({ cls: PROGRESS_FILL_CLASS });
		this.pctEl = barContainer.createDiv({ cls: PROGRESS_PCT_CLASS, text: "0%" });

		const bottomRow = content.createDiv({ cls: PROGRESS_PHASE_CLASS });
		this.phaseEl = bottomRow.createSpan({ text: this.phase });

		const cancelBtn = bottomRow.createEl("button", {
			text: "Cancel",
			cls: PROGRESS_CANCEL_CLASS,
		});
		cancelBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.onCancel?.();
			cancelBtn.disabled = true;
			cancelBtn.textContent = "Cancelling...";
		});

		this.updateBar();
	}

	private updateBar(): void {
		if (!this.fillEl || !this.pctEl) return;
		const pct = this.total > 0 ? Math.round((this.count / this.total) * 100) : 0;
		this.fillEl.style.width = `${pct}%`;
		this.pctEl.textContent = `${pct}%`;
	}
}
