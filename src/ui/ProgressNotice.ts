import { Notice } from "obsidian";

export class ProgressNotice {
	private notice: Notice | null = null;
	private message: string;
	private count = 0;
	private total = 0;
	onCancel: (() => void) | null = null;

	constructor(message: string) {
		this.message = message;
	}

	start(total: number): void {
		this.total = total;
		this.count = 0;
		this.update();
	}

	increment(): void {
		this.count++;
		this.update();
	}

	finish(finalMessage: string): void {
		this.notice?.hide();
		this.notice = null;
		new Notice(finalMessage, 5000);
	}

	private update(): void {
		const text =
			this.total > 0
				? `${this.message} (${this.count}/${this.total})`
				: this.message;

		if (this.notice) {
			this.notice.setMessage(text);
		} else {
			this.notice = new Notice(text, 0);
		}

		if (this.onCancel) {
			const el = (this.notice as unknown as { noticeEl: HTMLElement }).noticeEl;
			let cancelEl = el.querySelector(".progress-cancel");
			if (!cancelEl) {
				cancelEl = el.createEl("span", { text: " [cancel]", cls: "progress-cancel" });
				cancelEl.addEventListener("click", () => {
					this.onCancel?.();
				});
			}
		}
	}
}
