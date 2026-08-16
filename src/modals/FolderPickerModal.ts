import { App, Modal, Notice, TFolder } from 'obsidian';

/**
 * Modal that lists vault folders and calls back with the chosen path.
 * Used for "create board in this folder" and as the destination picker
 * in the Notion importer.
 */
export class FolderPickerModal extends Modal {
	private folders: TFolder[] = [];

	constructor(
		app: App,
		private title: string,
		private callback: (folderPath: string) => void,
		options?: { folders?: TFolder[]; skipEmptyNotice?: boolean }
	) {
		super(app);
		this.folders = options?.folders ?? this.collectFolders(app);
	}

	private collectFolders(app: App): TFolder[] {
		const result: TFolder[] = [];
		const visit = (folder: TFolder) => {
			result.push(folder);
			for (const child of folder.children) {
				if (child instanceof TFolder) visit(child);
			}
		};
		visit(app.vault.getRoot());
		return result.sort((a, b) => a.path.localeCompare(b.path));
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: this.title });

		if (this.folders.length === 0) {
			contentEl.createEl('p', { text: 'No folders in this vault.' });
			return;
		}

		for (const folder of this.folders) {
			const row = contentEl.createDiv({ cls: 'colorcoder-picker-row' });
			row.createEl('span', { text: folder.path === '/' ? '/' : folder.path });
			row.createEl('small', {
				text: `${folder.children.filter(c => c instanceof TFolder).length} subfolder(s)`,
				cls: 'colorcoder-picker-path',
			});
			row.addEventListener('click', () => {
				this.callback(folder.path);
				this.close();
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Convenience: open the folder picker for board creation. */
export function openCreateBoardPicker(app: App, createBoard: (folderPath: string) => Promise<void>): void {
	new FolderPickerModal(app, 'Create ColorCoder board in…', async folderPath => {
		try {
			await createBoard(folderPath);
		} catch (e) {
			new Notice(String(e));
		}
	}).open();
}
