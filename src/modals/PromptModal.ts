import { App, Modal, Setting } from 'obsidian';

/** Simple text-input prompt used for renaming auto-maintained fields. */
export class PromptModal extends Modal {
	constructor(
		app: App,
		private title: string,
		private message: string,
		private initialValue: string,
		private onConfirm: (value: string) => void,
		private confirmLabel = 'OK'
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: this.title });
		contentEl.createEl('p', { text: this.message, cls: 'cc-confirm-message' });

		let value = this.initialValue;
		new Setting(contentEl)
			.addText(text => text
				.setValue(this.initialValue)
				.onChange(v => { value = v; }))
			.addButton(button => button
				.setButtonText('Cancel')
				.setDestructive()
				.onClick(() => this.close()))
			.addButton(button => button
				.setButtonText(this.confirmLabel)
				.setCta()
				.onClick(() => {
					this.close();
					this.onConfirm(value.trim());
				}));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}