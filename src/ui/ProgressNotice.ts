import { Notice } from "obsidian";

export class ProgressNotice {
	private notice: Notice | null = null;
	private message: string;
	private count = 0;
	private total = 0;

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
		new Notice(finalMessage, 5000);
	}

	private update(): void {
		const text =
			this.total > 0
				? `${this.message} (${this.count}/${this.total})`
				: this.message;
		this.notice?.hide();
		this.notice = new Notice(text, 0);
	}
}
