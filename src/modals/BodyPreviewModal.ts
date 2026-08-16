import { App, Modal, Notice, setIcon } from 'obsidian';
import { TaskFileSchema } from '../types/task-schema';

/**
 * Small preview popup showing the note body of a card. Intentionally tiny —
 * the user asked for "as much as fits", not a full note editor.
 */
export class BodyPreviewModal extends Modal {
	constructor(app: App, private task: TaskFileSchema) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('cc-body-preview');
		this.modalEl.addClass('cc-body-preview-modal');

		const header = contentEl.createDiv({ cls: 'cc-body-preview-header' });
		header.createEl('strong', { text: this.task._title || 'Notes' });

		const actions = header.createDiv({ cls: 'cc-body-preview-actions' });
		const openBtn = actions.createEl('button', {
			cls: 'clickable-icon',
			attr: { 'aria-label': 'Open note' },
		});
		setIcon(openBtn, 'document');
		openBtn.addEventListener('click', () => {
			const file = this.app.vault?.getFileByPath(this.task._file);
			if (file) {
				this.app.workspace.getLeaf(false).openFile(file);
				this.close();
			} else {
				new Notice('File not found');
			}
		});

		const body = contentEl.createDiv({ cls: 'cc-body-preview-body' });
		body.createEl('pre', { text: this.task._body?.trim() || '(empty)' });
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
