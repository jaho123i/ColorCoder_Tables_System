import { App, Modal, Notice, TFile } from 'obsidian';
import { ColumnSchema } from '../types/index';
import { TaskFileSchema } from '../types/task-schema';
import { normalizePropertyValue } from '../core/property-types';
import { ColorCoderManager } from '../core/ColorCoderManager';

/**
 * Minimal value picker opened by clicking a property pill on a board card:
 * just the property's values as clickable rows (a plain auto-saving input for
 * free-text types). Clicking a value writes it to the task and closes.
 */
export class FieldValueModal extends Modal {
	private multiselectPicked = new Set<string>();

	constructor(
		app: App,
		private manager: ColorCoderManager,
		private boardFile: TFile | null,
		private task: TaskFileSchema,
		private prop: ColumnSchema
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass('cc-modal');
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: this.prop.name });

		const key = this.prop.id || this.prop.name;
		const current = this.task[key];

		const apply = (value: unknown) => {
			if (!this.boardFile) return;
			const normalized = normalizePropertyValue(value, this.prop.type);
			void this.manager?.updateTaskField(this.boardFile, this.task._file, key, normalized)
				.then((ok: boolean) => { if (!ok) new Notice(`Failed to update ${this.prop.name}`); });
		};
		const pick = (value: unknown) => { apply(value); this.close(); };

		const list = contentEl.createDiv({ cls: 'cc-value-list' });
		const addOption = (label: string, active: boolean, onClick: () => void, checked = false) => {
			const btn = list.createEl('button', { text: label, cls: 'cc-value-option' });
			if (active) btn.addClass('is-active');
			if (checked) btn.addClass('is-checked');
			btn.addEventListener('click', onClick);
			return btn;
		};

		switch (this.prop.type) {
			case 'checkbox': {
				const isTrue = current === true || current === 'true' || current === 'yes';
				addOption('true', isTrue, () => pick(true));
				addOption('false', !isTrue, () => pick(false));
				return;
			}
			case 'select': {
				const options = this.prop.options?.map(o => o.value) ?? [];
				const cur = current === undefined || current === null ? '' : String(current);
				for (const v of options) addOption(v, v === cur, () => pick(v));
				addOption('(none)', cur === '', () => pick(''));
				return;
			}
			case 'multiselect': {
				const options = this.prop.options?.map(o => o.value) ?? [];
				const cur = Array.isArray(current)
					? current.map(String)
					: current
						? String(current).split(',').map(s => s.trim()).filter(Boolean)
						: [];
				this.multiselectPicked = new Set(cur);
				for (const v of options) {
					const btn = addOption(v, false, () => {
						if (this.multiselectPicked.has(v)) {
							this.multiselectPicked.delete(v);
							btn.removeClass('is-checked');
						} else {
							this.multiselectPicked.add(v);
							btn.addClass('is-checked');
						}
						apply([...this.multiselectPicked]);
					}, this.multiselectPicked.has(v));
				}
				// Each toggle already saved; Done just closes.
				addOption('Done', false, () => this.close());
				return;
			}
			case 'date':
			case 'datetime': {
				const withTime = this.prop.type === 'datetime' || this.prop.withTime;
				const input = list.createEl('input', { type: withTime ? 'datetime-local' : 'date', cls: 'cc-value-input' });
				const cur = current === undefined || current === null ? '' : String(current).replace(' ', 'T');
				// datetime-local needs YYYY-MM-DDTHH:mm; date needs YYYY-MM-DD.
				input.value = withTime ? cur.slice(0, 16) : cur.slice(0, 10);
				const commit = () => pick(input.value ? normalizePropertyValue(input.value, withTime ? 'datetime' : 'date') : '');
				input.addEventListener('change', commit);
				input.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); });
				return;
			}
			case 'number': {
				const input = list.createEl('input', { type: 'number', cls: 'cc-value-input' });
				input.value = current === undefined || current === null ? '' : String(current);
				const commit = () => pick(input.value.trim() === '' ? '' : normalizePropertyValue(input.value.trim(), 'number'));
				input.addEventListener('change', commit);
				input.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); });
				return;
			}
			default: {
				// text and any unknown types → plain auto-saving input.
				const input = list.createEl('input', { type: 'text', cls: 'cc-value-input' });
				input.value = current === undefined || current === null ? '' : String(current);
				input.focus();
				const commit = () => pick(input.value);
				input.addEventListener('change', commit);
				input.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); });
				return;
			}
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}