import { App, Modal, TFile } from 'obsidian';

export class ColorCoderPickerModal extends Modal {
	private boards: TFile[];
	private callback: (file: TFile) => void;

	constructor(app: App, boards: TFile[], callback: (file: TFile) => void) {
		super(app);
		this.boards = boards;
		this.callback = callback;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Select a board' });

		if (this.boards.length === 0) {
			contentEl.createEl('p', { text: 'No ColorCoder boards found.' });
			return;
		}

		for (const board of this.boards) {
			const row = contentEl.createDiv({ cls: 'colorcoder-picker-row' });
			row.createEl('span', { text: board.basename });
			row.createEl('small', {
				text: board.parent?.path || '/',
				cls: 'colorcoder-picker-path',
			});
			row.addEventListener('click', () => {
				this.callback(board);
				this.close();
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
