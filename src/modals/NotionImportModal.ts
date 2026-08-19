import { App, Modal, Notice, TFolder, TFile } from 'obsidian';
import { FolderPickerModal } from './FolderPickerModal';
import { parseNotionTask } from '../core/notion-importer';
import { ColorCoderManager } from '../core/ColorCoderManager';

/**
 * Import a Notion Markdown export into a ColorCoder board.
 *
 * Flow:
 *  1. Pick the source folder (the export root, e.g. "Export-90c0da9d...").
 *  2. Pick the destination vault folder.
 *  3. Every .md file with frontmatter under the source becomes a task;
 *     database pages (no frontmatter, only wiki-links) are skipped.
 *  4. A board file is created in the destination folder.
 */
export class NotionImportModal extends Modal {
	constructor(app: App, private manager: ColorCoderManager) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Import Notion Export' });
		contentEl.createEl('p', {
			text: 'Pick the exported Notion folder, then a destination for the new board.',
		});

		const step1 = contentEl.createDiv();
		step1.createEl('h3', { text: '1. Source folder (Notion export)' });
		const sourcePathEl = step1.createEl('div', { cls: 'colorcoder-picker-path', text: 'not selected' });
		step1.createEl('button', { text: 'Choose…' }).addEventListener('click', () => {
			new FolderPickerModal(this.app, 'Import from…', path => {
				sourcePathEl.setText(path);
				startImportBtn.disabled = false;
				void importNotion(path);
			}).open();
		});

		const step2 = contentEl.createDiv();
		step2.createEl('h3', { text: '2. Destination folder' });
		const destPathEl = step2.createEl('div', { cls: 'colorcoder-picker-path', text: 'not selected' });
		let destPath = '';
		step2.createEl('button', { text: 'Choose…' }).addEventListener('click', () => {
			new FolderPickerModal(this.app, 'Import into…', path => {
				destPath = path;
				destPathEl.setText(path);
			}).open();
		});

		const startImportBtn = contentEl.createEl('button', { text: 'Start Import', cls: 'mod-cta' });
		startImportBtn.disabled = true;

		const importNotion = async (sourcePath: string) => {
			try {
				const { files, skipped } = await collectNotionFiles(this.app, sourcePath);
				if (files.length === 0) {
					new Notice('No Notion task files (files with frontmatter) found in that folder.');
					return;
				}

				const stats = { created: 0, failed: 0 };
				for (const file of files) {
					const content = await this.app.vault.read(file);
					const task = parseNotionTask(file.basename, content);
					if (!task.hasFrontmatter) {
						skipped.push(file.path);
						continue;
					}
					// Preserve every Notion property as-is (schema-driven import).
					const props = { ...task.frontmatter, title: task.title };
					const result = await this.manager.createTask(destPath, props);
					if (result.success) stats.created++;
					else stats.failed++;
				}

				await this.manager.createBoard(destPath);

				new Notice(
					`Imported ${stats.created} tasks${stats.failed ? `, ${stats.failed} failed` : ''}` +
						(skipped.length ? ` (skipped ${skipped.length} database pages)` : '')
				);
				this.close();
			} catch (e) {
				new Notice(`Import failed: ${String(e)}`);
			}
		};
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Recursively collect .md files that carry frontmatter. Returns them plus a mutable skipped list. */
async function collectNotionFiles(app: App, folderPath: string): Promise<{ files: TFile[]; skipped: string[] }> {
	const files: TFile[] = [];
	const skipped: string[] = [];

	const visit = async (folder: TFolder) => {
		for (const child of folder.children) {
			if (child instanceof TFolder) {
				await visit(child);
			} else if (child instanceof TFile && child.extension === 'md') {
				const content = await app.vault.cachedRead(child);
				if (content.trimStart().startsWith('---')) {
					files.push(child);
				} else {
					skipped.push(child.path);
				}
			}
		}
	};

	const folder = app.vault.getAbstractFileByPath(folderPath);
	if (folder instanceof TFolder) {
		await visit(folder);
	}
	return { files, skipped };
}
