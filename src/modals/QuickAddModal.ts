import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import { ColumnSchema } from '../types/index';
import { FieldNames } from '../core/task-file-manager';
import { normalizePropertyValue } from '../core/property-types';
import { ConfirmModal } from './ConfirmModal';
import { ColorCoderManager } from '../core/ColorCoderManager';

export class QuickAddModal extends Modal {
	constructor(
		app: App,
		private manager: ColorCoderManager,
		private boardFile: TFile,
		private schema: ColumnSchema[],
		private properties: string[] = [],
		private fieldNames?: FieldNames
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Quick Add Task' });

		let title = '';
		const extra: Record<string, unknown> = {};

		// Inline error area — shown in red when validation fails so the warning
		// is impossible to miss (a transient Notice is easy to overlook).
		const errorEl = contentEl.createDiv({ cls: 'cc-quickadd-error' });
		errorEl.hide();
		const showError = (msg: string) => {
			errorEl.setText(msg);
			errorEl.show();
			new Notice(msg, 8000);
		};

		new Setting(contentEl)
			.setName('Title')
			.addText(text => text
				.setPlaceholder('Task title')
				.onChange(value => { title = value; }));

		// Filter out auto-maintained fields (Created At / Updated At) from the schema.
		// Use the board's effective field names (supports renamed fields).
		// Match against both schema.id (frontmatter key) and schema.name (display name).
		const autoFieldNames = new Set([
			this.fieldNames?.createdAt,
			this.fieldNames?.updatedAt,
		].filter(Boolean));
		const schema = this.schema.filter(p => !autoFieldNames.has(p.id) && !autoFieldNames.has(p.name));

		if (schema.length === 0) {
			// No properties defined yet — just the title. The board is
			// schema-driven; once properties are detected they appear here.
			contentEl.createEl('p', {
				text: 'No properties defined yet — add a property to a task file and it will appear here.',
				cls: 'cc-customize-hint',
			});

			this.renderCreateButton(contentEl, () => ({
				title: title.trim(),
			}), showError);
			return;
		}

		// One typed field per defined property.
		for (const prop of schema) {
			this.renderTypedField(contentEl, prop, extra);
		}

		this.renderCreateButton(contentEl, () => ({ title: title.trim(), ...extra }), showError);
	}

	/** Renders the input(s) for one property based on its type and stores the value into `extra`. */
	private renderTypedField(container: HTMLElement, prop: ColumnSchema, extra: Record<string, unknown>): void {
		const key = prop.id || prop.name;
		switch (prop.type) {
			case 'select': {
				const options = prop.options?.map(o => o.value) ?? [];
				new Setting(container)
					.setName(prop.name)
					.addDropdown(dropdown => {
						dropdown.addOption('', '(none)');
						for (const value of options) dropdown.addOption(value, value);
						dropdown.setValue('');
						dropdown.onChange(value => { if (value) extra[key] = value; });
					});
				return;
			}
			case 'multiselect': {
				const options = prop.options?.map(o => o.value) ?? [];
				const picked: string[] = [];
				for (const value of options) {
					new Setting(container)
						.setName(value)
						.addToggle(toggle => toggle
							.setValue(false)
							.onChange(checked => {
								if (checked) picked.push(value);
								else {
									const i = picked.indexOf(value);
									if (i >= 0) picked.splice(i, 1);
								}
								extra[key] = [...picked];
							}));
				}
				return;
			}
			case 'date': {
				// Native date picker; the "Include time" toggle switches it to a
				// datetime-local picker. Values are normalized to YYYY-MM-DD or
				// ISO so they round-trip through frontmatter.
				const setting = new Setting(container).setName(prop.name);
				const input = setting.controlEl.createEl('input', {
					type: prop.withTime ? 'datetime-local' : 'date',
				});
				input.addEventListener('change', () => {
					if (input.value) {
						extra[key] = prop.withTime
							? normalizePropertyValue(input.value, 'datetime')
							: normalizePropertyValue(input.value, 'date');
					}
				});
				return;
			}
			case 'checkbox': {
				new Setting(container)
					.setName(prop.name)
					.addToggle(toggle => toggle
						.setValue(false)
						.onChange(checked => { extra[key] = checked; }));
				return;
			}
			case 'number': {
				new Setting(container)
					.setName(prop.name)
					.addText(text => text
						.setPlaceholder('0')
						.onChange(value => { if (value.trim()) extra[key] = normalizePropertyValue(value.trim(), 'number'); }));
				return;
			}
			case 'reference': {
				new Setting(container)
					.setName(prop.name)
					.setDesc(prop.refBoardPath ? `Inside ${prop.refBoardPath}` : 'Any file, including another task')
					.addText(text => text
						.setPlaceholder('path/to/file')
						.onChange(value => { if (value.trim()) extra[key] = value.trim(); }));
				return;
			}
			case 'lastEdit':
				// Auto-maintained — nothing to fill in.
				return;
			default:
				// text and any legacy/unknown types → plain text input.
				new Setting(container)
					.setName(prop.name)
					.addText(text => text.onChange(value => { if (value.trim()) extra[key] = value.trim(); }));
				return;
		}
	}

	private renderCreateButton(container: HTMLElement, getPayload: () => Record<string, unknown>, showError: (msg: string) => void): void {
		new Setting(container)
			.addButton(button => button
				.setButtonText('Create')
				.setCta()
				.onClick(async () => {
					const payload = getPayload();
					if (!payload.title) {
						showError('Task title is required');
						return;
					}
					const folderPath = this.boardFile.parent?.path ?? '';
					const result = await this.manager.createTask(folderPath, payload, undefined, this.boardFile);
					if (result.success) {
						new Notice('Task created');
						this.close();
					} else if (result.conflict) {
						// File already exists — warn and propose a "(1)" filename.
						const base = String(payload.title).replace(/[\\/:*?"<>|#^[\]]/g, '').trim() || 'Untitled';
						let suffix = 1;
						let proposed = `${base} (${suffix}).md`;
						while (this.app.vault.getAbstractFileByPath(`${folderPath}/${proposed}`)) {
							suffix += 1;
							proposed = `${base} (${suffix}).md`;
						}
						new ConfirmModal(
							this.app,
							'Task already exists',
							`A file named "${base}.md" already exists in this folder. Create "${proposed}" instead?`,
							() => {
								void (async () => {
									const retry = await this.manager.createTask(folderPath, payload, { fileName: proposed }, this.boardFile);
									if (retry.success) {
										new Notice(`Task created as ${proposed}`);
										this.close();
									} else {
										new Notice(`Failed to create task: ${retry.error?.message ?? 'unknown error'}`);
									}
								})();
							},
							'Create'
						).open();
					} else {
						new Notice(`Failed to create task: ${result.error?.message ?? 'unknown error'}`);
					}
				}));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
