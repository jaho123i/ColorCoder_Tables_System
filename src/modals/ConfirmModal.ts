import { App, Modal, Setting, ButtonComponent } from 'obsidian';

/** Small confirmation dialog used before destructive actions (delete property, delete rule). */
export class ConfirmModal extends Modal {
	constructor(
		app: App,
		private title: string,
		private message: string,
		private onConfirm: () => void,
		private confirmLabel = 'Delete',
		private onCancel?: () => void,
		private danger = false
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: this.title });
		contentEl.createEl('p', { text: this.message, cls: 'cc-confirm-message' });

		let confirmBtn: ButtonComponent | undefined;
		if (this.danger) {
			contentEl.createEl('p', { text: '⚠ User action needed — this cannot be undone.', cls: 'cc-confirm-danger' });
			new Setting(contentEl)
				.setName('I understand')
				.addToggle(toggle => toggle
					.setValue(false)
					.onChange(v => confirmBtn?.setDisabled(!v)));
		}

		new Setting(contentEl)
			.addButton(button => button
				.setButtonText('Cancel')
				.setWarning()
				.onClick(() => {
					this.close();
					this.onCancel?.();
				}))
			.addButton(button => {
				confirmBtn = button
					.setButtonText(this.confirmLabel)
					.setCta()
					.onClick(() => {
						this.close();
						this.onConfirm();
					});
				if (this.danger) confirmBtn.setDisabled(true);
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}