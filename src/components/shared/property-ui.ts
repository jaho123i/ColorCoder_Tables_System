import { App, DropdownComponent, ToggleComponent, ColorComponent, Setting, setIcon } from 'obsidian';
import { ColorRule, ColorRuleKind, ColumnSchema, GradientValueConfig } from '../../types/index';
import { ConfirmModal } from '../../modals/ConfirmModal';
import { COLUMN_TYPE_OPTIONS } from '../../core/property-types';
import { DEFAULT_COLOR_RULES, gradientColorAt } from '../../core/color-coding';

/**
 * Shared property/color-rule editors used by BOTH the plugin Settings tab and
 * the board Customize modal. The two editors render identical rows so the
 * plugin never has two drifting copies of the property type UI.
 */

/**
 * Re-render `render()` while preserving scroll positions. Captures every
 * scrollable ancestor of `el` and restores them after re-render, so it works
 * across surfaces (Settings tab vs modal) without guessing class names.
 */
export function preserveScroll(el: HTMLElement, render: () => void): void {
	const scrollers: { el: HTMLElement; top: number }[] = [];
	let node: HTMLElement | null = el;
	while (node && node !== document.body) {
		if (node.scrollHeight > node.clientHeight) scrollers.push({ el: node, top: node.scrollTop });
		node = node.parentElement;
	}
	render();
	for (const s of scrollers) s.el.scrollTop = s.top;
}

export interface PropertyRowOptions {
	/** Vault usage stats for this property (Settings only) — shows a summary line. */
	stat?: { key: string; count: number; values: string[]; type: string };
	/** Persist any mutation. */
	onChange: () => void | Promise<void>;
	/** Toggle hide (eye icon) — keeps it in the schema but hidden from the board. */
	onToggleHide: (prop: ColumnSchema) => void | Promise<void>;
	/** Delete the property and its values from every task (trash icon, dangerous). */
	onRemove: (prop: ColumnSchema) => void | Promise<void>;
	/** Names of all OTHER properties (incl. the auto fields) — used to warn on
	 *  a rename that collides with an existing property name. */
	existingNames?: Set<string>;
}

/** Shared property row: name + type dropdown + Remove + type-specific detail. */
export function renderPropertyRow(
	app: App,
	containerEl: HTMLElement,
	prop: ColumnSchema,
	opts: PropertyRowOptions
): void {
	const row = containerEl.createDiv({ cls: 'cc-props-row' });
	const isHidden = prop.excluded === true;
	if (isHidden) row.addClass('cc-props-row-hidden');
	const line1 = row.createDiv({ cls: 'cc-props-line' });

	const isLastEdit = prop.type === 'lastEdit';
	const nameInput = line1.createEl('input', {
		type: 'text',
		placeholder: 'property name',
		cls: 'cc-props-name',
		value: isLastEdit ? (prop.name === 'Last edit' ? 'Last edit' : prop.name) : prop.name,
	});
	nameInput.addEventListener('change', () => {
		const name = nameInput.value.trim();
		if (!name) {
			// A property must have a name — revert a blank edit.
			nameInput.value = prop.name;
			return;
		}
		const apply = () => {
			prop.name = name;
			// id follows the name so grouping matches the frontmatter key. For
			// Last edit the name IS the frontmatter key it writes to, so renaming
			// it renames the field the plugin stamps on every task change.
			prop.id = name;
			if (isLastEdit) prop.fieldName = name;
			void opts.onChange();
		};
		// Warn (with a user action) when the new name collides with another
		// property — including ones created or renamed earlier in this session.
		if (opts.existingNames?.has(name)) {
			new ConfirmModal(
				app,
				'Duplicate property name',
				`Another property is already named "${name}". Two properties with the same name can be confusing. Use it anyway?`,
				apply,
				'Use anyway',
				undefined,
				true
			).open();
		} else {
			apply();
		}
	});

	const dropdown = new DropdownComponent(line1);
	const optionMap: Record<string, string> = {};
	for (const o of COLUMN_TYPE_OPTIONS) optionMap[o.value] = o.label;
	// Date & time is one type now: a legacy `datetime` property shows as Date
	// (its "Include time" toggle stays on via withTime).
	const displayType = prop.type === 'datetime' ? 'date' : prop.type;
	dropdown
		.addOptions(optionMap)
		.setValue(displayType)
		.onChange(async (value) => {
			applyTypeConversion(prop, value as ColumnSchema['type'], opts.stat?.values ?? []);
			await opts.onChange();
			// Seamless refresh: only re-render this row's detail section.
			detail.empty();
			renderDetail();
		});

	const hide = line1.createEl('button', { cls: 'cc-prop-hide', title: isHidden ? 'Show property' : 'Hide property' });
	setIcon(hide, isHidden ? 'eye-off' : 'eye');
	hide.addEventListener('click', () => void opts.onToggleHide(prop));

	const remove = line1.createEl('button', { cls: 'cc-prop-remove', title: 'Delete property and its values' });
	setIcon(remove, 'trash');
	remove.addEventListener('click', () => {
		// Tell the user how many instances will actually be removed.
		const stat = opts.stat;
		const instanceLine = stat && stat.count > 0
			? `\n\n${stat.count} file${stat.count === 1 ? '' : 's'} currently use this property — their values will be removed.`
			: '';
		new ConfirmModal(
			app,
			'Delete property',
			`Delete property "${prop.name}" and remove its values from every task in this board? This cannot be undone.${instanceLine}`,
			() => {
				row.remove();
				void opts.onRemove(prop);
			},
			'Delete',
			undefined,
			true
		).open();
	});

	// Second line: type-specific controls or usage summary. Re-rendered in
	// place on type change so the settings page doesn't reload.
	const detail = row.createDiv({ cls: 'cc-props-detail' });
	const renderDetail = () => {
		// Hidden properties are shown shrunk/grayed so they can be un-hidden;
		// their type-specific detail is collapsed to keep the row compact.
		if (isHidden) return;
		if (prop.type === 'lastEdit') {
			// "Last edit" is a system field: fixed name, exposed as a toggle
			// (auto-update). It always writes to the `updatedAt` frontmatter key.
			const line = detail.createDiv({ cls: 'cc-props-line' });
			line.createSpan({ text: 'Auto-update', cls: 'cc-props-label' });
			new ToggleComponent(line)
				.setValue(prop.autoUpdate ?? true)
				.onChange(async (v) => {
					prop.autoUpdate = v;
					await opts.onChange();
				});
			detail.createDiv({ text: 'Stored in the `updatedAt` field — updated automatically whenever the task changes.' });
			return;
		}
		if (prop.type === 'select' || prop.type === 'multiselect') {
			renderSelectOptions(detail, prop, opts.onChange);
		}
		if (prop.type === 'date' || prop.type === 'datetime') {
			const line2 = detail.createDiv({ cls: 'cc-props-line' });
			line2.createSpan({ text: 'Include time', cls: 'cc-props-label' });
			new ToggleComponent(line2)
				.setValue(prop.withTime ?? false)
				.onChange(async (v) => {
					prop.withTime = v;
					await opts.onChange();
				});
		}
		if (prop.type === 'reference') {
			const line2 = detail.createDiv({ cls: 'cc-props-line' });
			line2.createSpan({ text: 'Folder', cls: 'cc-props-label' });
			const input = line2.createEl('input', {
				type: 'text',
				placeholder: 'e.g. Tasks/',
				cls: 'cc-props-folder',
				value: prop.refBoardPath ?? '',
			});
			input.addEventListener('change', async () => {
				prop.refBoardPath = input.value.trim() || undefined;
				await opts.onChange();
			});
		}
		if (opts.stat) {
			// Show how many files actually use this property (not the total file
			// count of the board/vault).
			const usage = `${opts.stat.count} file${opts.stat.count === 1 ? '' : 's'} use this property · ${opts.stat.values.length} value${opts.stat.values.length === 1 ? '' : 's'}`;
			const preview = opts.stat.values.slice(0, 5).join(', ') + (opts.stat.values.length > 5 ? ', …' : '');
			detail.createDiv({ text: `${usage}${preview ? ` — ${preview}` : ''}`, cls: 'cc-props-usage' });
		}
	};
	renderDetail();
}

/**
 * Change a property's type and handle every conversion pair safely:
 * - to Selection/Multiselection: options are merged with the existing values
 *   found in the vault/board, so switching Text → Selection instantly shows
 *   every value already in use (existing hand-ordered options are kept).
 * - Selection ↔ Multiselection: options are kept.
 * - away from Date/Datetime: stale type-only fields are cleared.
 * - to/from Last edit: the frontmatter key flips between `updatedAt` and
 *   the property name.
 * Existing data is never rewritten — only the schema/options change.
 */
export function applyTypeConversion(
	prop: ColumnSchema,
	newType: ColumnSchema['type'],
	existingValues: string[]
): void {
	const isSelect = newType === 'select' || newType === 'multiselect';
	if (isSelect) {
		// Merge (never replace): keep the user's option order, then append any
		// values already in use that aren't options yet.
		const have = new Set((prop.options ?? []).map(o => o.value));
		const merged = [...(prop.options ?? [])];
		for (const v of existingValues) {
			if (v.trim() !== '' && !have.has(v)) {
				merged.push({ value: v });
				have.add(v);
			}
		}
		prop.options = merged;
	}
	if (newType !== 'date' && newType !== 'datetime') prop.withTime = undefined;
	if (newType !== 'reference') prop.refBoardPath = undefined;
	if (newType === 'lastEdit') {
		prop.id = prop.fieldName ?? 'updatedAt';
	} else if (prop.type === 'lastEdit') {
		prop.id = prop.name.trim() || prop.id;
	}
	prop.type = newType;
}

function renderSelectOptions(containerEl: HTMLElement, prop: ColumnSchema, onChange: () => void | Promise<void>): void {
	// Sort controls sit in their own compact row ABOVE the values list.
	const sortRow = containerEl.createDiv({ cls: 'cc-props-line cc-option-sort-row' });
	sortRow.createSpan({ text: 'Auto:', cls: 'cc-props-label' });
	const sortGroup = sortRow.createDiv({ cls: 'cc-option-sorts' });
	const sortAZ = sortGroup.createEl('button', { text: 'A–Z', title: 'Sort A to Z', cls: 'cc-option-sort' });
	const sortZA = sortGroup.createEl('button', { text: 'Z–A', title: 'Sort Z to A', cls: 'cc-option-sort' });
	const list = containerEl.createDiv({ cls: 'cc-option-list' });
	const render = () => {
		list.empty();
		const options = prop.options ?? (prop.options = []);
		// Always show the user-set order with arrows (like the Custom order
		// system), so the order is meaningful for gradient rules too.
		for (let i = 0; i < options.length; i++) {
			const option = options[i];
			const row = list.createDiv({ cls: 'cc-option-row' });
			row.createSpan({ text: option.value, cls: 'cc-option-value' });
			const move = (from: number, to: number) => {
				const [it] = options.splice(from, 1);
				options.splice(to, 0, it);
				void onChange();
				render();
			};
			const top = row.createEl('button', { title: 'Move to top', cls: 'cc-option-order' });
			setIcon(top, 'arrow-up-to-line');
			top.disabled = i === 0;
			top.addEventListener('click', () => { if (i !== 0) move(i, 0); });
			const up = row.createEl('button', { title: 'Move up', cls: 'cc-option-order' });
			setIcon(up, 'arrow-up');
			up.disabled = i === 0;
			up.addEventListener('click', () => { if (i !== 0) move(i, i - 1); });
			const down = row.createEl('button', { title: 'Move down', cls: 'cc-option-order' });
			setIcon(down, 'arrow-down');
			down.disabled = i === options.length - 1;
			down.addEventListener('click', () => { if (i !== options.length - 1) move(i, i + 1); });
			const bottom = row.createEl('button', { title: 'Move to bottom', cls: 'cc-option-order' });
			setIcon(bottom, 'arrow-down-to-line');
			bottom.disabled = i === options.length - 1;
			bottom.addEventListener('click', () => { if (i !== options.length - 1) move(i, options.length - 1); });
			row.createEl('button', { text: 'Remove', cls: 'mod-warning' }).addEventListener('click', () => {
				options.splice(i, 1);
				void onChange();
				render();
			});
		}
		const addWrap = list.createDiv({ cls: 'cc-option-add' });
		const input = addWrap.createEl('input', { type: 'text', placeholder: 'New option…', cls: 'cc-option-input' });
		const addBtn = addWrap.createEl('button', { text: 'Add' });
		const commit = () => {
			const v = input.value.trim();
			if (v) {
				options.push({ value: v });
				void onChange();
				input.value = '';
				render();
			}
		};
		addBtn.addEventListener('click', commit);
		input.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') commit();
		});
	};
	sortAZ.addEventListener('click', () => {
		prop.options?.sort((a, b) => a.value.localeCompare(b.value, undefined, { sensitivity: 'base' }));
		void onChange();
		render();
	});
	sortZA.addEventListener('click', () => {
		prop.options?.sort((a, b) => b.value.localeCompare(a.value, undefined, { sensitivity: 'base' }));
		void onChange();
		render();
	});
	render();
}

/* ──────────────────────────────────────────────────────────────────────
 * Shared "Properties" tab body used by BOTH Settings → Properties and the
 * board Customize → Properties. The two surfaces differ only in how they
 * persist (Settings saves immediately; Customize stages until Apply) and in
 * the vault-usage stats they show — both are passed in as callbacks, so the
 * rendered UI is identical and never drifts.
 *
 * The tab is split into:
 *   top block  — the auto-maintained fields (Created At / Updated At) plus an
 *                optional "Clean up rare properties" action, in the same
 *                Setting-row style as the General tab.
 *   list       — every property (except removed and the hidden Last edit),
 *                each with its type dropdown and type-specific detail.
 *   add        — a button to add an empty property.
 * ────────────────────────────────────────────────────────────────────── */

export interface PropertiesTabOptions {
	/** Mutable schema; the renderer reads it and the callbacks mutate it. */
	schema: ColumnSchema[];
	title: string;
	description: string;
	/** Vault/board usage stats for a property (Settings: vault; Customize: tasks). */
	getStat?: (prop: ColumnSchema) => { key: string; count: number; values: string[]; type: string } | undefined;
	/** Persist a change (Settings: save; Customize: mark dirty). */
	onChange: () => void | Promise<void>;
	/** Toggle hide (eye icon) — keeps it in the schema but hidden. */
	onToggleHide: (prop: ColumnSchema) => void | Promise<void>;
	/** Delete a property and its values (trash icon, dangerous). */
	onRemove: (prop: ColumnSchema) => void | Promise<void>;
	/** Add an empty property. */
	onAdd: () => void | Promise<void>;
	/** Re-render the tab after structural changes (add/remove). */
	refresh: () => void;
	/** Auto-maintained field toggles shown at the top. */
	autoFields: {
		createdAt: AutoFieldOptions;
		updatedAt: AutoFieldOptions;
	};
}

/** One auto-maintained timestamp field (Created At / Updated At). */
export interface AutoFieldOptions {
	enabled: boolean;
	onChange: (v: boolean) => void | Promise<void>;
	/** Current frontmatter key (e.g. "createdAt"). */
	fieldName: string;
	/** Rename the field. The caller prompts for the new name, confirms the
	 *  warning, persists, and re-renders (via `refresh`). */
	onRename: (currentName: string) => void | Promise<void>;
}

export function renderPropertiesTab(app: App, containerEl: HTMLElement, opts: PropertiesTabOptions): void {
	containerEl.createEl('h3', { text: opts.title });
	containerEl.createEl('p', { text: opts.description, cls: 'setting-item-description' });

	// ── Top block: auto fields (General-settings style) ─────────────
	const autoBlock = containerEl.createDiv({ cls: 'cc-auto-fields' });
	const renderAutoField = (field: AutoFieldOptions, desc: string) => {
		const card = autoBlock.createDiv({ cls: 'cc-settings-card' });
		// The row title IS the field name (the standard names "Created At" /
		// "Updated At" match their titles; a renamed field shows its new key).
		const setting = new Setting(card)
			.setName(field.fieldName)
			.setDesc(`${desc} Frontmatter key: ${field.fieldName}.`)
			.addToggle(toggle => toggle
				.setValue(field.enabled)
				.onChange(v => void field.onChange(v)));
		// Pencil sits right next to the name (not at the far end of the row).
		const renameBtn = setting.nameEl.createEl('button', {
			cls: 'cc-auto-rename',
			title: `Rename the "${field.fieldName}" field`,
		});
		setIcon(renameBtn, 'pencil');
		renameBtn.addEventListener('click', () => void field.onRename(field.fieldName));
	};
	renderAutoField(opts.autoFields.createdAt, 'Stamp the creation timestamp on every new task.');
	renderAutoField(opts.autoFields.updatedAt, 'Stamp the last-edit timestamp on every task change.');

	// ── Property list ────────────────────────────────────────────────
	const table = containerEl.createDiv({ cls: 'cc-props-table' });
	table.createDiv({ cls: 'cc-props-header' })
		.createSpan({ text: 'Property · Type · Details' });

	// Properties render in schema order (the order they were added), so a newly
	// added property appears at the bottom of the list instead of jumping into
	// an alphabetical slot.
	const autoNames = new Set([opts.autoFields.createdAt.fieldName, opts.autoFields.updatedAt.fieldName]);
	for (const prop of opts.schema) {
		if (prop.type === 'lastEdit') continue; // hidden — managed by the Updated At toggle
		if (autoNames.has(prop.id)) continue; // hide auto-maintained timestamp fields (supports renamed fields)
		// Names of every OTHER property (plus the auto fields) so a rename that
		// collides with an existing name — including one created or renamed in
		// this same session — triggers a warning.
		const others = new Set(opts.schema.filter(p => p.id !== prop.id).map(p => p.name ?? p.id));
		for (const n of autoNames) others.add(n);
		renderPropertyRow(app, table, prop, {
			stat: opts.getStat?.(prop),
			onChange: opts.onChange,
			onToggleHide: () => void opts.onToggleHide(prop),
			onRemove: () => void opts.onRemove(prop),
			existingNames: others,
		});
	}

	// ── Add property ─────────────────────────────────────────────────
	const addBtn = containerEl.createEl('button', { text: '+ Add property', cls: 'mod-cta cc-add-property' });
	addBtn.addEventListener('click', () => void opts.onAdd());
}

/* ──────────────────────────────────────────────────────────────────────
 * Shared "General" tab body used by BOTH Settings → General and the board
 * Customize → View tab. Every value flows through a getter + setter callback
 * so the same code renders either the plugin defaults (Settings) or a
 * board-specific override (Customize). Each row is rendered as its own card
 * so the tab matches the Color Rules card style.
 * ────────────────────────────────────────────────────────────────────── */

export interface GeneralTabOptions {
	/** Settings-only: the default board file name (hidden for boards). */
	databaseFileName?: string;
	onDatabaseFileNameChange?: (v: string) => void | Promise<void>;
	/** Customize-only: this board's database file name — the board file's own
	 *  name. Editing it renames the file (the value IS the file name). */
	boardFileName?: string;
	onBoardFileNameChange?: (v: string) => void | Promise<void>;
	pageSize: number;
	onPageSizeChange: (v: number) => void | Promise<void>;
	colorGroupPanels: boolean;
	onColorGroupPanelsChange: (v: boolean) => void | Promise<void>;
	cardFontSize: number;
	onCardFontSizeChange: (v: number) => void | Promise<void>;
	compactMode: boolean;
	onCompactModeChange: (v: boolean) => void | Promise<void>;
}

export function renderGeneralTab(containerEl: HTMLElement, opts: GeneralTabOptions): void {
	const card = (name: string, desc: string, build: (setting: Setting) => void) => {
		const wrap = containerEl.createDiv({ cls: 'cc-settings-card' });
		build(new Setting(wrap).setName(name).setDesc(desc));
	};

	if (opts.databaseFileName !== undefined && opts.onDatabaseFileNameChange) {
		card('Database file name', 'Name of the board database file. Used when creating a new board; existing boards keep their current name. Leave empty for the default.', setting => {
			setting.addText(text => text
				.setPlaceholder('ColorCoder-board')
				.setValue(opts.databaseFileName!)
				.onChange(async (value) => {
					// Empty is allowed: it means "use the default name".
					await opts.onDatabaseFileNameChange!(value.trim());
				}));
		});
	}

	if (opts.boardFileName !== undefined && opts.onBoardFileNameChange) {
		card('Database file name', 'The name of this board\u2019s database file. Renaming it renames the file.', setting => {
			setting.addText(text => text
				.setPlaceholder('ColorCoder-board')
				.setValue(opts.boardFileName!)
				.onChange(async (value) => {
					await opts.onBoardFileNameChange!(value);
				}));
		});
	}

	card('Cards per column', 'Maximum cards shown in each board column before a "Show more" control appears. Set to 0 for no limit.', setting => {
		setting.addText(text => text
			.setPlaceholder('50')
			.setValue(String(opts.pageSize))
			.onChange(async (value) => {
				const n = parseInt(value, 10);
				await opts.onPageSizeChange(isNaN(n) || n < 0 ? 0 : n);
			}));
	});

	card('Color group panels', 'Tint each board column/swimlane with its matching color rule (less intense), and color the panel title with it.', setting => {
		setting.addToggle(toggle => toggle
			.setValue(opts.colorGroupPanels)
			.onChange(async (value) => {
				await opts.onColorGroupPanelsChange(value);
			}));
	});

	card('Card text size', 'Font size (px) of the main text on board cards.', setting => {
		setting.addText(text => text
			.setPlaceholder('14')
			.setValue(String(opts.cardFontSize))
			.onChange(async (value) => {
				const n = parseInt(value, 10);
				await opts.onCardFontSizeChange(isNaN(n) || n <= 0 ? 14 : n);
			}));
	});

	card('Compact mode', 'Show the toolbar actions as icons only: Customize becomes a paint palette and Add task becomes a plus.', setting => {
		setting.addToggle(toggle => toggle
			.setValue(opts.compactMode)
			.onChange(async (value) => {
				await opts.onCompactModeChange(value);
			}));
	});
}

/* ──────────────────────────────────────────────────────────────────────
 * Color rule editor (shared between Settings and Customize modal).
 *
 * A rule row is split into three zones:
 *   header  — rule name + kind toggle + Remove (the "dangerous" action)
 *   body    — the rule's own editor (condition match or gradient points)
 *   footer  — Priority, separated from the body for quick scanning
 * ────────────────────────────────────────────────────────────────────── */

/** Seed a gradient rule's ordered point list from a property's options. */
function seedGradientFromProperty(rule: ColorRule, properties?: ColumnSchema[]): void {
	const prop = properties?.find(p => p.id === rule.columnId);
	const values = prop?.options?.map(o => o.value) ?? [];
	rule.gradientValues = values.map(v => ({ value: v, auto: true, autoText: true }));
}

function makeRule(kind: ColorRuleKind, properties?: ColumnSchema[]): ColorRule {
	const firstProp = properties?.[0];
	const rule: ColorRule = {
		id: `rule-${Date.now()}`,
		name: kind === 'gradient' ? 'New gradient' : 'New rule',
		kind,
		columnId: firstProp?.id ?? '',
		operator: 'is',
		value: '',
		backgroundColor: '#9E9E9E',
		textColor: '#FFFFFF',
		priority: 0,
	};
	if (kind === 'gradient') {
		rule.gradientStart = '#4CAF50';
		rule.gradientEnd = '#F44336';
		rule.gradientTextStart = '#FFFFFF';
		rule.gradientTextEnd = '#FFFFFF';
		seedGradientFromProperty(rule, properties);
	}
	return rule;
}

/** Shared color rule row with the header / body / footer split. */
export function renderColorRuleRow(
	app: App,
	containerEl: HTMLElement,
	rule: ColorRule,
	onChange: () => void | Promise<void>,
	onRemove: () => void | Promise<void>,
	properties?: ColumnSchema[],
	onMove?: (dir: -1 | 1) => void
): void {
	const row = containerEl.createDiv({ cls: 'cc-rule-card' });

	// ── Header: name + kind toggle ──────────────────────────────
	const header = row.createDiv({ cls: 'cc-rule-header' });
	const nameInput = header.createEl('input', {
		type: 'text',
		placeholder: 'Rule name',
		cls: 'cc-props-name cc-rule-name',
		value: rule.name,
	});
	nameInput.addEventListener('change', async () => {
		rule.name = nameInput.value;
		await onChange();
	});

	renderKindToggle(header, rule, properties, onChange, () => {
		body.empty();
		renderBody();
	});

	// ── Body: kind-specific editor ──────────────────────────────
	const body = row.createDiv({ cls: 'cc-rule-body' });
	const renderBody = () => {
		if ((rule.kind ?? 'condition') === 'gradient') {
			renderGradientEditor(body, rule, properties, onChange);
		} else {
			renderConditionEditor(body, rule, properties, onChange);
		}
	};
	renderBody();

	// ── Footer: Rule priority (arrows) + Remove (bottom-right, red) ──
	const footer = row.createDiv({ cls: 'cc-rule-footer' });
	footer.createSpan({ text: 'Rule priority', cls: 'cc-rule-footer-label' });
	if (onMove) {
		const up = footer.createEl('button', { text: '↑', title: 'Move rule up (higher priority)', cls: 'cc-rule-order' });
		up.addEventListener('click', () => onMove(-1));
		const down = footer.createEl('button', { text: '↓', title: 'Move rule down (lower priority)', cls: 'cc-rule-order' });
		down.addEventListener('click', () => onMove(1));
	}

	const remove = footer.createEl('button', { text: '✕', title: 'Remove rule', cls: 'cc-rule-remove' });
	remove.addEventListener('click', () => {
		new ConfirmModal(app, 'Remove rule', `Remove color rule "${rule.name}"? Cards will no longer be colored by it.`, () => {
			void onRemove();
		}).open();
	});
}

/** Segmented Condition | Gradient toggle. */
function renderKindToggle(
	containerEl: HTMLElement,
	rule: ColorRule,
	properties: ColumnSchema[] | undefined,
	onChange: () => void | Promise<void>,
	refresh: () => void
): void {
	const seg = containerEl.createDiv({ cls: 'cc-kind-toggle' });
	const kinds: [ColorRuleKind, string][] = [
		['condition', 'Condition'],
		['gradient', 'Gradient'],
	];
	const buttons: HTMLElement[] = [];
	for (const [kind, label] of kinds) {
		const btn = seg.createEl('button', { text: label, cls: `cc-kind-btn cc-kind-${kind}` });
		if ((rule.kind ?? 'condition') === kind) btn.addClass('is-active');
		buttons.push(btn);
		btn.addEventListener('click', async () => {
			if ((rule.kind ?? 'condition') === kind) return;
			rule.kind = kind;
			if (kind === 'gradient' && (!rule.gradientValues || rule.gradientValues.length === 0)) {
				seedGradientFromProperty(rule, properties);
			}
			// Highlight live: flip the is-active class immediately, then
			// re-render the body for the new kind.
			buttons.forEach(b => b.removeClass('is-active'));
			btn.addClass('is-active');
			await onChange();
			refresh();
		});
	}
}

/** Condition editor: match property/operator/value + color pickers. */
function renderConditionEditor(
	containerEl: HTMLElement,
	rule: ColorRule,
	properties: ColumnSchema[] | undefined,
	onChange: () => void | Promise<void>
): void {
	const line2 = containerEl.createDiv({ cls: 'cc-props-line' });
	line2.createSpan({ text: 'Condition', cls: 'cc-props-label' });
	if (properties && properties.length > 0) {
		const columnSel = new DropdownComponent(line2);
		const opts: Record<string, string> = {};
		for (const p of properties) opts[p.id] = p.name ?? p.id;
		if (!(rule.columnId in opts)) opts[rule.columnId] = rule.columnId;
		columnSel
			.addOptions(opts)
			.setValue(rule.columnId)
			.onChange(async (value) => {
				rule.columnId = value;
				await onChange();
			});
	} else {
		const columnInput = line2.createEl('input', {
			type: 'text',
			placeholder: 'property (e.g. priority)',
			cls: 'cc-rule-column',
			value: rule.columnId,
		});
		columnInput.addEventListener('change', async () => {
			rule.columnId = columnInput.value;
			await onChange();
		});
	}

	const operatorSel = new DropdownComponent(line2);
	operatorSel
		.addOptions({
			is: 'is',
			is_not: 'is not',
			contains: 'contains',
			not_contains: 'not contains',
			starts_with: 'starts with',
			ends_with: 'ends with',
			gt: '>',
			lt: '<',
			is_empty: 'is empty',
			is_not_empty: 'is not empty',
		})
		.setValue(rule.operator)
		.onChange(async (value) => {
			rule.operator = value as ColorRule['operator'];
			await onChange();
		});

	const valueInput = line2.createEl('input', {
		type: 'text',
		placeholder: 'value (e.g. high)',
		cls: 'cc-rule-value',
		value: rule.value,
	});
	valueInput.addEventListener('change', async () => {
		rule.value = valueInput.value;
		await onChange();
	});

	const line3 = containerEl.createDiv({ cls: 'cc-props-line' });
	line3.createSpan({ text: 'Color', cls: 'cc-props-label' });
	const swatch = line3.createDiv({ cls: 'cc-rule-swatch', text: 'Aa' });
	const updateSwatch = () => {
		swatch.setAttribute('style', `background-color:${rule.backgroundColor};color:${rule.textColor}`);
	};
	updateSwatch();

	new ColorComponent(line3)
		.setValue(rule.backgroundColor)
		.onChange(async (value) => {
			rule.backgroundColor = value;
			updateSwatch();
			await onChange();
		});
	new ColorComponent(line3)
		.setValue(rule.textColor)
		.onChange(async (value) => {
			rule.textColor = value;
			updateSwatch();
			await onChange();
		});
}

/* ──────────────────────────────────────────────────────────────────────
 * Gradient editor: a gradient is a list of points over a property's values.
 * First and last points are always present and set the start/end colors;
 * middle points are optional (add/remove) and either auto-interpolate or
 * override the color per value.
 * ────────────────────────────────────────────────────────────────────── */

function renderGradientEditor(
	containerEl: HTMLElement,
	rule: ColorRule,
	properties: ColumnSchema[] | undefined,
	onChange: () => void | Promise<void>
): void {
	const values = rule.gradientValues ?? (rule.gradientValues = []);

	// ── Description row ─────────────────────────────────────────
	containerEl.createDiv({
		cls: 'setting-item-description cc-gradient-desc',
		text: 'The first and last values set the gradient\u2019s start and end colors. Middle values can stay locked to the gradient (auto) or override it with their own color.',
	});

	// ── Property selector ───────────────────────────────────────
	const propLine = containerEl.createDiv({ cls: 'cc-props-line' });
	propLine.createSpan({ text: 'Property', cls: 'cc-props-label' });
	if (properties && properties.length > 0) {
		const columnSel = new DropdownComponent(propLine);
		const opts: Record<string, string> = {};
		for (const p of properties) opts[p.id] = p.name ?? p.id;
		if (!(rule.columnId in opts)) opts[rule.columnId] = rule.columnId;
		columnSel
			.addOptions(opts)
			.setValue(rule.columnId)
			.onChange(async (value) => {
				rule.columnId = value;
				seedGradientFromProperty(rule, properties);
				await onChange();
				refresh();
			});
	} else {
		const columnInput = propLine.createEl('input', {
			type: 'text',
			placeholder: 'property (e.g. priority)',
			cls: 'cc-rule-column',
			value: rule.columnId,
		});
		columnInput.addEventListener('change', async () => {
			rule.columnId = columnInput.value;
			await onChange();
		});
	}

	const preview = containerEl.createDiv({ cls: 'cc-rule-swatch cc-gradient-swatch', text: 'Aa' });

	// Auto circles (locked middle points) that must re-color whenever any
	// gradient color changes, so they always show the current interpolated
	// color. Each entry knows how to recompute its own color.
	const autoCircles: { el: HTMLElement; getColor: () => string }[] = [];

	// The whole editor is re-rendered on structural changes (property change,
	// point add/remove) so the point list always reflects the current state.
	const refresh = () => {
		containerEl.empty();
		renderGradientEditor(containerEl, rule, properties, onChange);
	};

	const renderPoints = () => {
		// clear the previous points table (keep property selector + swatch)
		containerEl.querySelectorAll('.cc-gradient-table, .cc-gradient-add').forEach(el => el.remove());
		// Drop stale auto-circle registrations before rebuilding the table.
		autoCircles.length = 0;
		updateSwatch();

		if (values.length === 0) {
			const empty = containerEl.createDiv({ cls: 'cc-props-detail' });
			empty.setText('No points yet — add the property values the gradient should cover.');
			return;
		}

		const table = containerEl.createDiv({ cls: 'cc-gradient-table' });

		// Header row: fixed column names so every point lines up.
		const head = table.createDiv({ cls: 'cc-gradient-row cc-gradient-head' });
		head.createSpan({ text: 'Value', cls: 'cc-gradient-col-label' });
		head.createSpan({ text: 'bg', cls: 'cc-gradient-col-label' });
		head.createSpan({ text: 'text', cls: 'cc-gradient-col-label' });
		head.createSpan({ text: '', cls: 'cc-gradient-col-label' });

		// Mirror the property's option order so the gradient list always
		// matches the order the user set in Properties.
		const prop = properties?.find(p => p.id === rule.columnId);
		const orderMap = new Map((prop?.options ?? []).map((o, idx) => [o.value, idx]));
		values.sort((a, b) => {
			const ia = orderMap.has(a.value) ? orderMap.get(a.value)! : Number.MAX_SAFE_INTEGER;
			const ib = orderMap.has(b.value) ? orderMap.get(b.value)! : Number.MAX_SAFE_INTEGER;
			return ia - ib;
		});

		values.forEach((cfg, i) => {
			const isFirst = i === 0;
			const isLast = i === values.length - 1;
			const prow = table.createDiv({ cls: 'cc-gradient-row' });

			renderPointValue(prow, rule, cfg, properties, onChange, refresh);

			if (isFirst || isLast) {
				// Endpoints: always the gradient start/end colors, always adjustable.
				const bound = isFirst
					? { get: () => rule.gradientStart ?? '#4CAF50', set: (c: string) => (rule.gradientStart = c) }
					: { get: () => rule.gradientEnd ?? '#F44336', set: (c: string) => (rule.gradientEnd = c) };
				const bgCell = prow.createDiv({ cls: 'cc-gradient-cell' });
				const bg = new ColorComponent(bgCell);
				bg.setValue(bound.get());
				bg.onChange(async (c) => { bound.set(c); updateSwatch(); await onChange(); });
				const textCell = prow.createDiv({ cls: 'cc-gradient-cell' });
				const text = new ColorComponent(textCell);
				text.setValue(isFirst ? (rule.gradientTextStart ?? '#FFFFFF') : (rule.gradientTextEnd ?? '#FFFFFF'));
				text.onChange(async (c) => {
					if (isFirst) rule.gradientTextStart = c; else rule.gradientTextEnd = c;
					await onChange();
				});
				prow.createSpan({ text: isFirst ? 'start' : 'end', cls: 'cc-gradient-badge' });
			} else {
				renderGradientOverride(prow, cfg, onChange, updateSwatch, (key, autoKey) => colorAt(i, key, autoKey), autoCircles);
				const rm = prow.createEl('button', { text: '✕', title: 'Remove point', cls: 'cc-gradient-remove' });
				rm.addEventListener('click', () => {
					values.splice(i, 1);
					void onChange();
					renderPoints();
				});
			}
		});

		// Add a middle point from the property's remaining values. Only show
		// the "all used" message when the property actually has options to add;
		// a text property (no options) just has no dropdown to offer.
		const all = prop?.options?.map(o => o.value) ?? [];
		const unused = all.filter(v => !values.some(g => g.value === v));
		const addLine = containerEl.createDiv({ cls: 'cc-gradient-add' });
		if (all.length > 0 && unused.length === 0) {
			addLine.createSpan({ text: 'All property values are on the gradient.', cls: 'cc-props-detail' });
		} else if (all.length > 0) {
			const addSel = new DropdownComponent(addLine);
			const opts: Record<string, string> = {};
			for (const v of unused) opts[v] = v;
			addSel.addOptions(opts).setValue(unused[0]);
			const btn = addLine.createEl('button', { text: '+ Add point', cls: 'cc-gradient-add-btn' });
			btn.addEventListener('click', () => {
				const cfgNew: GradientValueConfig = { value: addSel.getValue(), auto: true, autoText: true };
				// Insert before the last point so the gradient stays ordered.
				values.splice(values.length - 1, 0, cfgNew);
				void onChange();
				renderPoints();
			});
		}
	};

	/**
	 * Color at a point index: middle points with an explicit override use it;
	 * everything else interpolates between the nearest defined colors, so the
	 * whole gradient bends through chosen middle colors. Shared with the board
	 * so cards always match the editor preview.
	 */
	const colorAt = (i: number, key: 'color' | 'textColor', autoKey: 'auto' | 'autoText'): string =>
		gradientColorAt(rule, values, i, key, autoKey);

	const updateSwatch = () => {
		// Re-color every auto circle to the current interpolated color.
		for (const c of autoCircles) {
			const col = c.getColor();
			c.el.setCssStyles({ background: col, color: contrastColor(col) });
		}
		if (values.length < 2) {
			preview.setCssStyles({ background: 'transparent', color: 'var(--text-muted)' });
			return;
		}
		const stops = values.map((_, i) => colorAt(i, 'color', 'auto'));
		preview.setCssStyles({ background: `linear-gradient(90deg, ${stops.join(', ')})`, color: '#fff' });
	};

	renderPoints();
}

/** Value dropdown for one point: offers every property value except values
 *  already used by other points, so each value appears once. */
/** Value input for one point: a plain text field (a list picker is useless
 *  here — the value is just a label the gradient matches against). */
function renderPointValue(
	row: HTMLElement,
	rule: ColorRule,
	cfg: GradientValueConfig,
	properties: ColumnSchema[] | undefined,
	onChange: () => void | Promise<void>,
	refresh: () => void
): void {
	const wrap = row.createDiv({ cls: 'cc-gradient-value' });
	const input = wrap.createEl('input', { type: 'text', placeholder: 'value', cls: 'cc-rule-value', value: cfg.value });
	input.addEventListener('change', async () => {
		cfg.value = input.value.trim() || cfg.value;
		await onChange();
		refresh();
	});
}

/**
 * Middle point override: a fixed-width cell per color. Each cell always holds
 * a lock/unlock button plus a color area of the same size — locked shows an
 * auto circle (the interpolated color at this point with a contrasting auto
 * sign), unlocked shows the real color picker — so unlocking never shifts the
 * layout.
 */
function renderGradientOverride(
	row: HTMLElement,
	cfg: GradientValueConfig,
	onChange: () => void | Promise<void>,
	updateSwatch: () => void,
	getAutoColor: (key: 'color' | 'textColor', autoKey: 'auto' | 'autoText') => string,
	autoCircles: { el: HTMLElement; getColor: () => string }[]
): void {
	const bgCell = row.createDiv({ cls: 'cc-gradient-cell' });
	renderColorLock(bgCell, 'color', 'auto', cfg, onChange, updateSwatch, () => getAutoColor('color', 'auto'), autoCircles);
	const textCell = row.createDiv({ cls: 'cc-gradient-cell' });
	renderColorLock(textCell, 'textColor', 'autoText', cfg, onChange, updateSwatch, () => getAutoColor('textColor', 'autoText'), autoCircles);
}

/** One lockable color in a fixed-width cell: color area first, lock button
 *  after it. Unlocking seeds the picker with the auto (interpolated) color,
 *  and the lock icon gets no hover highlight while unlocked. */
function renderColorLock(
	cell: HTMLElement,
	key: 'color' | 'textColor',
	autoKey: 'auto' | 'autoText',
	cfg: GradientValueConfig,
	onChange: () => void | Promise<void>,
	updateSwatch: () => void,
	getAutoColor: () => string,
	autoCircles: { el: HTMLElement; getColor: () => string }[]
): void {
	const locked = autoKey === 'auto' ? (cfg.auto !== false) : (cfg.autoText !== false);
	cell.empty();

	if (locked) {
		// Auto circle: shows the interpolated color at this point, with a
		// contrasting auto sign on top. Registered so it re-colors whenever
		// any gradient color changes.
		const autoColor = getAutoColor();
		const auto = cell.createEl('button', { title: 'Auto — follows the gradient', cls: 'cc-gradient-auto-btn' });
		auto.setAttribute('style', `background:${autoColor};color:${contrastColor(autoColor)}`);
		setIcon(auto, 'wand-2');
		autoCircles.push({ el: auto, getColor: getAutoColor });
	} else {
		const picker = new ColorComponent(cell);
		picker.setValue((key === 'color' ? cfg.color : cfg.textColor) ?? getAutoColor());
		picker.onChange(async (v) => {
			if (key === 'color') { cfg.color = v; cfg.auto = false; }
			else { cfg.textColor = v; cfg.autoText = false; }
			updateSwatch();
			await onChange();
		});
	}

	const lockBtn = cell.createEl('button', {
		title: locked ? 'Locked to gradient — click to override' : 'Overriding gradient — click to lock again',
		cls: `cc-gradient-lock-btn${locked ? '' : ' is-unlocked'}`,
	});
	setIcon(lockBtn, locked ? 'lock' : 'unlock');

	lockBtn.addEventListener('click', async () => {
		if (locked) {
			// Unlock: default the override to the auto-picked color. Compute it
			// BEFORE flipping cfg.auto, since colorAt() treats an unlocked value
			// with a stored color as an override.
			const autoColor = getAutoColor();
			if (autoKey === 'auto') { cfg.auto = false; cfg.color = autoColor; }
			else { cfg.autoText = false; cfg.textColor = autoColor; }
		} else {
			if (autoKey === 'auto') cfg.auto = true; else cfg.autoText = true;
		}
		renderColorLock(cell, key, autoKey, cfg, onChange, updateSwatch, getAutoColor, autoCircles);
		updateSwatch();
		await onChange();
	});
}

/** Pick a readable foreground (white or near-black) for a hex background. */
function contrastColor(hex: string): string {
	const n = parseInt(hex.replace('#', ''), 16);
	const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
	// Perceived luminance (Rec. 709).
	const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
	return lum > 150 ? '#212121' : '#FFFFFF';
}

/* ──────────────────────────────────────────────────────────────────────
 * Shared tab-level renderers (Settings → Color Rules, Customize → Color
 * Rules) so both surfaces use the exact same code.
 * ────────────────────────────────────────────────────────────────────── */

export interface ColorRulesTabOptions {
	rules: ColorRule[];
	properties: ColumnSchema[];
	/** Persist a change (Settings: save; Customize: mark dirty). */
	onChange: () => void | Promise<void>;
	/** Re-render the tab/pane after structural changes (add/remove). */
	refresh: () => void;
	/** When true, seed the built-in defaults on first open (Settings only). */
	seedDefaults?: boolean;
	/** Optional extra description rendered under the heading. */
	description?: string;
}

/** Shared "Color Rules" tab body used by both Settings and Customize. */
export function renderColorRulesTab(app: App, containerEl: HTMLElement, opts: ColorRulesTabOptions): void {
	containerEl.createEl('h3', { text: 'Color Rules' });
	containerEl.createEl('p', {
		text: opts.description ?? 'Cards are colored by the first matching rule (highest priority first). Each rule either matches a condition or colors a property by gradient over its values.',
		cls: 'setting-item-description',
	});

	if (opts.seedDefaults && opts.rules.length === 0) {
		// Seed the built-in example rules, but only for properties that
		// actually exist in the schema (matched case-insensitively), and remap
		// each rule's columnId to the real property id. This avoids showing a
		// rule on a non-existent "priority" when the schema uses "Priority".
		const byLower = new Map((opts.properties ?? []).map(p => [p.id.toLowerCase(), p.id]));
		const seeded = DEFAULT_COLOR_RULES
			.map(r => ({ ...r }))
			.filter(r => byLower.has(r.columnId.toLowerCase()))
			.map(r => ({ ...r, columnId: byLower.get(r.columnId.toLowerCase())! }));
		opts.rules.push(...seeded);
		void opts.onChange();
	}

	const table = containerEl.createDiv({ cls: 'cc-props-table' });
	table.createDiv({ cls: 'cc-props-header' })
		.createSpan({ text: 'Rule · Type · Match / Gradient · Priority' });

	for (const rule of opts.rules) {
		renderColorRuleRow(
			app,
			table,
			rule,
			opts.onChange,
			() => {
				const idx = opts.rules.indexOf(rule);
				if (idx >= 0) opts.rules.splice(idx, 1);
				void opts.onChange();
				opts.refresh();
			},
			opts.properties,
			(dir) => {
				const idx = opts.rules.indexOf(rule);
				const target = idx + dir;
				if (idx < 0 || target < 0 || target >= opts.rules.length) return;
				// Priority = array position (index 0 is the highest priority),
				// so moving a rule just reorders the list.
				const [moved] = opts.rules.splice(idx, 1);
				opts.rules.splice(target, 0, moved);
				opts.rules.forEach((r, i) => { r.priority = opts.rules.length - i; });
				void opts.onChange();
				opts.refresh();
			}
		);
	}

	const addButtons = containerEl.createDiv({ cls: 'cc-rule-add' });
	const mkAdd = (kind: ColorRuleKind, label: string) => {
		const btn = addButtons.createEl('button', { text: label, cls: 'mod-cta' });
		btn.addEventListener('click', () => {
			opts.rules.push(makeRule(kind, opts.properties));
			void opts.onChange();
			opts.refresh();
		});
	};
	mkAdd('condition', '+ Add condition rule');
	mkAdd('gradient', '+ Add gradient rule');
}
