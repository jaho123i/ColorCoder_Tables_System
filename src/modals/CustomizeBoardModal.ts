import { App, Modal, Notice, TFile, setIcon } from 'obsidian';
import { ViewConfig, ColumnSchema, ColorRule, BoardConfig } from '../types/index';
import { TaskFileSchema } from '../types/task-schema';
import { renderPropertiesTab, renderColorRulesTab, renderGeneralTab, preserveScroll } from '../components/shared/property-ui';
import { resolveGroupField } from '../hooks/useBoardData';
import { ConfirmModal } from './ConfirmModal';
import { PromptModal } from './PromptModal';
import { ColorCoderManager } from '../core/ColorCoderManager';

/** Fallback board file name when the database file name is cleared. */
const DEFAULT_BOARD_FILE_NAME = 'ColorCoder-board';

/**
 * "Customize board" popup.
 *
 * Tabs:
 *  - View: General settings (per-board), sort direction, custom column/swimlane
 *    order, visible groups, empty groups, which property values show on cards.
 *  - Properties: the board-wide property definitions (types, options, …).
 *  - Color Rules: the global card color rules (same as Settings → Color Rules).
 *
 * Changes are staged until Apply. Closing (Cancel / Esc) with unsaved changes
 * asks whether to discard them.
 */
export class CustomizeBoardModal extends Modal {
	constructor(
		app: App,
		private manager: ColorCoderManager,
		private boardFile: TFile,
		private view: ViewConfig,
		private schema: ColumnSchema[],
		private tasks: TaskFileSchema[],
		private properties: string[],
		private colorRules: ColorRule[],
		private boardConfig: BoardConfig,
		private onSaveSettings: () => Promise<void>,
		private onApplied: () => void
	) {
		super(app);
	}

	private activeTab: 'general' | 'view' | 'properties' | 'colors' = 'general';
	/** Staged copy of the color rules — only written back on Apply. */
	private stagedRules: ColorRule[] = [];
	/** Renames staged from the pencil icons; executed on Apply. */
	private pendingRenames: { kind: 'createdAt' | 'updatedAt'; oldName: string; newName: string }[] = [];
	/** Staged board file rename (Customize → General); executed on Apply. */
	private pendingBoardRename: string | null = null;
	/** Property ids staged for deletion (trash icon); executed on Apply. */
	private pendingRemovals: string[] = [];
	/** True once any staged change is made; drives the discard confirmation. */
	private dirty = false;
	private discardConfirmed = false;
	/** Removes the Apply-menu outside-click listener (registered in onOpen). */
	private menuCleanup: (() => void) | null = null;
	/** Builds a human-readable list of the staged changes. Assigned in onOpen
	 *  (it closes over the staged state); used by the discard and apply
	 *  confirmations. */
	private buildSummary: () => string[] = () => [];

	onOpen(): void {
		this.modalEl.addClass('cc-modal');
		// Stage a copy so edits don't touch the live settings until Apply.
		this.stagedRules = this.colorRules.map(r => ({ ...r }));
		this.dirty = false;
		this.discardConfirmed = false;

		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Customize board' });

		// ── Tab bar ─────────────────────────────────────────────
		const tabs = contentEl.createDiv({ cls: 'cc-settings-tabs' });
		const renderTabs = () => {
			tabs.empty();
			const mk = (id: 'general' | 'view' | 'properties' | 'colors', label: string) => {
				const btn = tabs.createEl('button', { text: label, cls: 'cc-settings-tab' });
				if (this.activeTab === id) btn.addClass('is-active');
				btn.dataset.tab = id;
			};
			mk('general', 'General');
			mk('view', 'View');
			mk('properties', 'Properties');
			mk('colors', 'Color Rules');
		};

		const generalPane = contentEl.createDiv({ cls: 'cc-customize-pane' });
		const viewPane = contentEl.createDiv({ cls: 'cc-customize-pane' });
		const propsPane = contentEl.createDiv({ cls: 'cc-customize-pane' });
		const colorsPane = contentEl.createDiv({ cls: 'cc-customize-pane' });

		const showPane = () => {
			generalPane.style.display = this.activeTab === 'general' ? '' : 'none';
			viewPane.style.display = this.activeTab === 'view' ? '' : 'none';
			propsPane.style.display = this.activeTab === 'properties' ? '' : 'none';
			colorsPane.style.display = this.activeTab === 'colors' ? '' : 'none';
		};

		// Delegated listener on the tab bar container (survives re-renders).
		// Mobile modals can swallow per-button taps, so handle BOTH pointerdown
		// (fires immediately on touch) and click (desktop); the guard stops the
		// same tap from switching twice.
		let lastTab = '';
		let lastSwitch = 0;
		const activate = (id: string) => {
			const now = Date.now();
			if (id === lastTab && now - lastSwitch < 350) return;
			lastTab = id;
			lastSwitch = now;
			this.activeTab = id as 'general' | 'view' | 'properties' | 'colors';
			renderTabs();
			showPane();
		};
		const onTabEvent = (e: Event) => {
			const btn = (e.target as HTMLElement).closest('.cc-settings-tab') as HTMLElement | null;
			if (btn?.dataset.tab) activate(btn.dataset.tab);
		};
		tabs.addEventListener('pointerdown', onTabEvent);
		tabs.addEventListener('click', onTabEvent);

		// Staged per-board General settings. Boards are self-contained: their own
		// config wins, otherwise the canonical defaults are used. The plugin
		// settings only seed NEW boards (see ColorCoderManager.createBoard).
		const stagedBoard = {
			pageSize: this.boardConfig.pageSize ?? 50,
			colorGroupPanels: this.boardConfig.colorGroupPanels ?? false,
			cardFontSize: this.boardConfig.cardFontSize ?? 14,
			compactMode: this.boardConfig.compactMode ?? false,
			createdAtFieldName: this.boardConfig.createdAtFieldName ?? 'Created At',
			updatedAtFieldName: this.boardConfig.updatedAtFieldName ?? 'Updated At',
		};

		// ══ GENERAL TAB ════════════════════════════════════════
		// Shared with Settings → General; here it edits this board's own values.
		// "Database file name" is linked to the board file: the value IS the
		// file name, so editing it renames the file on Apply.
		const generalSection = generalPane.createDiv({ cls: 'cc-customize-section' });
		renderGeneralTab(generalSection, {
			boardFileName: this.boardFile.basename,
			onBoardFileNameChange: (name) => {
				const trimmed = name.trim().replace(/\.md$/i, '');
				// Empty means "use the default name" — the file is renamed back
				// to the default board file name on Apply.
				this.pendingBoardRename = trimmed || DEFAULT_BOARD_FILE_NAME;
				this.markDirty();
			},
			pageSize: stagedBoard.pageSize,
			onPageSizeChange: (n) => { stagedBoard.pageSize = n; this.markDirty(); },
			colorGroupPanels: stagedBoard.colorGroupPanels,
			onColorGroupPanelsChange: (v) => { stagedBoard.colorGroupPanels = v; this.markDirty(); },
			cardFontSize: stagedBoard.cardFontSize,
			onCardFontSizeChange: (n) => { stagedBoard.cardFontSize = n; this.markDirty(); },
			compactMode: stagedBoard.compactMode,
			onCompactModeChange: (v) => { stagedBoard.compactMode = v; this.markDirty(); },
		});

		// ══ VIEW TAB ════════════════════════════════════════════
		// Each setting group is rendered as its own card so the tab matches the
		// General / Color Rules card style.
		const viewCard = (title: string) => {
			const card = viewPane.createDiv({ cls: 'cc-settings-card cc-view-card' });
			card.createEl('h3', { text: title, cls: 'cc-view-card-title' });
			return card;
		};

		// ── Column sort + custom order ───────────────────────────
		const groupField = resolveGroupField(this.view, this.properties);
		const groupValues = distinctValues(this.tasks, groupField);
		const groupSection = viewCard(`Columns (${groupField})`);
		const groupState = this.renderSortSection(
			groupSection,
			groupValues,
			(this.view.boardColumnOrder ?? []).filter(v => groupValues.includes(v)),
			this.view.groupSortDirection,
			this.view.groupSortMode === 'stable' ? 'stable' : undefined
		);

		// ── Visible groups ───────────────────────────────────────
		const hiddenSet = new Set(this.view.hiddenGroups ?? []);
		const groupVisToggles: { value: string; el: HTMLInputElement }[] = [];
		const groupVisSection = viewCard('Visible groups');
		groupVisSection.createEl('p', {
			text: 'All values found in the task base — uncheck to hide a group. On by default.',
			cls: 'cc-customize-hint',
		});
		for (const value of groupValues) {
			const label = groupVisSection.createEl('label', { cls: 'cc-customize-field' });
			const checkbox = label.createEl('input', { type: 'checkbox' });
			checkbox.checked = !hiddenSet.has(`${groupField}:${value}`);
			checkbox.addEventListener('change', () => this.markDirty());
			label.appendText(` ${value}`);
			groupVisToggles.push({ value: `${groupField}:${value}`, el: checkbox });
		}

		// ── Swimlane sort + custom order ─────────────────────────
		let laneState: SortSectionState | null = null;
		let laneVisToggles: { value: string; el: HTMLInputElement }[] | null = null;
		if (this.view.swimlaneColumnId) {
			const laneField = this.view.swimlaneColumnId;
			const laneValues = distinctValues(this.tasks, laneField);
			const laneSection = viewCard(`Swimlanes (${laneField})`);
			laneState = this.renderSortSection(
				laneSection,
				laneValues,
				(this.view.boardSwimlaneOrder ?? []).filter(v => laneValues.includes(v)),
				this.view.swimlaneSortDirection,
				this.view.swimlaneSortMode === 'stable' ? 'stable' : undefined
			);

			const laneVisSection = viewCard('Visible swimlanes');
			laneVisSection.createEl('p', {
				text: 'Uncheck to hide a swimlane (and its tasks). On by default.',
				cls: 'cc-customize-hint',
			});
			laneVisToggles = [];
			for (const value of laneValues) {
				const label = laneVisSection.createEl('label', { cls: 'cc-customize-field' });
				const checkbox = label.createEl('input', { type: 'checkbox' });
				checkbox.checked = !hiddenSet.has(`${laneField}:${value}`);
				checkbox.addEventListener('change', () => this.markDirty());
				label.appendText(` ${value}`);
				laneVisToggles.push({ value: `${laneField}:${value}`, el: checkbox });
			}
		}

		// ── Empty groups ─────────────────────────────────────────
		const emptySection = viewCard('Empty groups');
		const emptyLabel = emptySection.createEl('label', { cls: 'cc-customize-field' });
		const showEmpty = emptyLabel.createEl('input', { type: 'checkbox' });
		showEmpty.checked = this.view.boardHideEmpty !== true;
		showEmpty.addEventListener('change', () => this.markDirty());
		emptyLabel.appendText(' Show groups that have no tasks');

		// ── Card fields ──────────────────────────────────────────
		const cardSection = viewCard('Show on cards');
		const cardFields = new Set(this.view.cardFields ?? []);
		const fieldToggles: { field: string; el: HTMLInputElement }[] = [];
		const cardProps = this.properties.filter(prop => {
			if (prop.startsWith('_')) return false;
			if (['id', 'title', 'createdAt', 'updatedAt'].includes(prop)) return false;
			return true;
		});
		if (cardProps.length === 0) {
			cardSection.createEl('p', {
				text: 'No properties found in this board yet — add a property to a task file and it will appear here.',
				cls: 'cc-customize-hint',
			});
		}
		for (const prop of cardProps) {
			const label = cardSection.createEl('label', { cls: 'cc-customize-field' });
			const checkbox = label.createEl('input', { type: 'checkbox' });
			checkbox.checked = cardFields.has(prop);
			checkbox.addEventListener('change', () => this.markDirty());
			label.appendText(` ${prop}`);
			fieldToggles.push({ field: prop, el: checkbox });
		}

		// ══ PROPERTIES TAB ══════════════════════════════════════
		// Shared renderer (same code as Settings → Properties), operating on a
		// staged copy of the board schema. Structural changes re-render just
		// this pane; everything is persisted on Apply.
		const propSection = propsPane.createDiv({ cls: 'cc-customize-section' });
		// Deep-copy the board schema so staged changes (removing a property sets
		// `excluded`) never leak into the board's live config when changes are
		// discarded — otherwise the property would stay hidden after Cancel.
		const boardSchema: ColumnSchema[] = this.schema.map(p => ({ ...p }));
		const schemaIds = new Set(boardSchema.map(p => p.id));
		// Exclude auto-maintained timestamp fields (Created At / Updated At) by
		// their current frontmatter keys (supports renamed fields).
		const autoFieldNames = new Set([
			stagedBoard.createdAtFieldName,
			stagedBoard.updatedAtFieldName,
		].filter(Boolean));
		// Filter out auto fields from the copied schema.
		for (let i = boardSchema.length - 1; i >= 0; i--) {
			if (autoFieldNames.has(boardSchema[i].id)) {
				boardSchema.splice(i, 1);
			}
		}
		for (const prop of this.properties) {
			if (prop.startsWith('_')) continue;
			if (autoFieldNames.has(prop)) continue;
			if (schemaIds.has(prop)) continue;
			boardSchema.push({ id: prop, name: prop, type: 'text', visible: true });
		}
		const renderProps = () => {
			preserveScroll(propSection, () => {
				propSection.empty();
				renderPropertiesTab(this.app, propSection, {
					schema: boardSchema,
					title: 'Properties (this board)',
					description: 'Board-wide property definitions. Any property found in the board folder is added automatically; pick its type here. These override the plugin defaults for this board.',
getStat: prop => ({
					key: prop.id,
					count: this.tasks.filter(t => {
						const v = t[prop.id];
						return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);
					}).length,
					values: distinctValues(this.tasks, prop.id),
					type: prop.type,
				}),
					onChange: () => this.markDirty(),
					onToggleHide: (prop) => {
						prop.excluded = !prop.excluded;
						this.markDirty();
						renderProps();
					},
onRemove: (prop) => {
					// Drop the property from the staged schema and delete its values
					// on Apply (pendingRemovals).
					const idx = boardSchema.findIndex(p => p.id === prop.id);
					if (idx >= 0) boardSchema.splice(idx, 1);
					this.pendingRemovals.push(prop.id);
					this.markDirty();
					renderProps();
				},
					onAdd: () => {
						boardSchema.push({ id: `prop-${Date.now()}`, name: 'New property', type: 'text', visible: true });
						this.markDirty();
						renderProps();
					},
					refresh: () => renderProps(),
					autoFields: {
						createdAt: {
							enabled: this.manager?.getSettings()?.autoUpdateCreatedAt !== false,
							fieldName: stagedBoard.createdAtFieldName,
							onChange: (v) => {
								const s = this.manager?.getSettings();
								if (s) s.autoUpdateCreatedAt = v;
								this.markDirty();
							},
							onRename: (currentName) => this.promptRenameAutoField('createdAt', currentName, stagedBoard, renderProps, boardSchema),
						},
						updatedAt: {
							enabled: this.manager?.getSettings()?.autoUpdateUpdatedAt !== false,
							fieldName: stagedBoard.updatedAtFieldName,
							onChange: (v) => {
								const s = this.manager?.getSettings();
								if (s) s.autoUpdateUpdatedAt = v;
								this.markDirty();
							},
							onRename: (currentName) => this.promptRenameAutoField('updatedAt', currentName, stagedBoard, renderProps, boardSchema),
						},
					},
				});
			});
		};
		renderProps();

		// ══ COLOR RULES TAB ════════════════════════════════════
		// Shared renderer (same code as Settings → Color Rules), operating on
		// the staged copy. Structural changes re-render just this pane.
		const renderColors = () => {
			// Preserve modal scroll so adding/removing a rule doesn't jump to top.
			preserveScroll(colorsPane, () => {
				colorsPane.empty();
				renderColorRulesTab(this.app, colorsPane, {
					rules: this.stagedRules,
					properties: boardSchema,
					onChange: () => this.markDirty(),
					refresh: () => renderColors(),
					description: 'This board\u2019s color rules (snapshotted from Settings when the board was created). Cards are colored by the first matching rule; built-in priority defaults are used until you add your own.',
				});
			});
		};
		renderColors();

		// ── Tab visibility ──────────────────────────────────────
		renderTabs();
		showPane();

		// ── Change summary ───────────────────────────────────────
		// Diffs the staged state against the originals; shown on Apply and on
		// discard so the user always sees what they are about to commit/lose.
		const origSortMode = (v: ViewConfig, key: 'group' | 'swimlane'): 'asc' | 'desc' | 'custom' | 'stable' => {
			const mode = key === 'group' ? v.groupSortMode : v.swimlaneSortMode;
			const dir = key === 'group' ? v.groupSortDirection : v.swimlaneSortDirection;
			const order = key === 'group' ? (v.boardColumnOrder ?? []) : (v.boardSwimlaneOrder ?? []);
			if (mode === 'stable') return 'stable';
			if (dir === 'asc' || dir === 'desc') return dir;
			return order.length > 0 ? 'custom' : 'stable';
		};
		const sortLabel = (m: 'asc' | 'desc' | 'custom' | 'stable'): string =>
			m === 'custom' ? 'custom order' : m === 'stable' ? 'stable (property order)' : m;
		this.buildSummary = () => {
			const lines: string[] = [];
			const orig = this.boardConfig;
			const s = stagedBoard;
			if (s.pageSize !== (orig.pageSize ?? 50)) lines.push(`Cards per column: ${orig.pageSize ?? 50} → ${s.pageSize}`);
			if (s.colorGroupPanels !== (orig.colorGroupPanels ?? false)) lines.push(`Color group panels: ${orig.colorGroupPanels ?? false ? 'on' : 'off'} → ${s.colorGroupPanels ? 'on' : 'off'}`);
			if (s.cardFontSize !== (orig.cardFontSize ?? 14)) lines.push(`Card text size: ${orig.cardFontSize ?? 14} → ${s.cardFontSize}`);
			if (s.compactMode !== (orig.compactMode ?? false)) lines.push(`Compact mode: ${orig.compactMode ?? false ? 'on' : 'off'} → ${s.compactMode ? 'on' : 'off'}`);
			if (this.pendingBoardRename && this.pendingBoardRename !== this.boardFile.basename) lines.push(`Board file renamed to "${this.pendingBoardRename}"`);
			// Renames are gathered per field: renaming the same field several
			// times in one session shows one line (first old name → last new name).
			for (const r of this.pendingRenames) {
				const label = r.kind === 'createdAt' ? 'Created At' : 'Updated At';
				lines.push(`Updated ${label} field: "${r.oldName}" → "${r.newName}"`);
			}
			for (const id of this.pendingRemovals) lines.push(`Deleted property "${id}" and its values`);
			const v = this.view;
			if (groupState.mode !== origSortMode(v, 'group')) lines.push(`Column order: ${sortLabel(groupState.mode)}`);
			if (laneState && laneState.mode !== origSortMode(v, 'swimlane')) lines.push(`Swimlane order: ${sortLabel(laneState.mode)}`);
			const hiddenGroups = [
				...groupVisToggles.filter(t => !t.el.checked).map(t => t.value),
				...(laneVisToggles ?? []).filter(t => !t.el.checked).map(t => t.value),
			];
			const origHidden = new Set(v.hiddenGroups ?? []);
			if (hiddenGroups.length !== origHidden.size || hiddenGroups.some(h => !origHidden.has(h))) {
				lines.push(`Visible groups: ${hiddenGroups.length} hidden`);
			}
			if (showEmpty.checked !== (v.boardHideEmpty !== true)) lines.push(`Empty groups: ${showEmpty.checked ? 'shown' : 'hidden'}`);
			const finalFields = fieldToggles.filter(t => t.el.checked).map(t => t.field);
			const origFields = new Set(v.cardFields ?? []);
			if (finalFields.length !== origFields.size || finalFields.some(f => !origFields.has(f))) {
				lines.push(`Show on cards: ${finalFields.length} field${finalFields.length === 1 ? '' : 's'}`);
			}
			const keptActive = boardSchema.filter(p => !p.excluded);
			// Filter auto fields from original schema for fair comparison.
			const origActive = this.schema.filter(p => !p.excluded && !autoFieldNames.has(p.id));
			if (keptActive.length !== origActive.length) lines.push(`Properties: ${origActive.length} → ${keptActive.length}`);
			if (this.stagedRules.length !== this.colorRules.length) lines.push(`Color rules: ${this.colorRules.length} → ${this.stagedRules.length}`);
			return lines;
		};

		// ── Footer ───────────────────────────────────────────────
		const footer = contentEl.createDiv({ cls: 'modal-button-container cc-apply-bar' });
		footer.createEl('button', { text: 'Cancel', cls: 'mod-warning' }).addEventListener('click', () => this.close());

		// Staged outputs shared by Apply / Apply to all boards / Override as defaults.
		const finalFields = () => fieldToggles.filter(t => t.el.checked).map(t => t.field);
		const hiddenGroups = () => [
			...groupVisToggles.filter(t => !t.el.checked).map(t => t.value),
			...(laneVisToggles ?? []).filter(t => !t.el.checked).map(t => t.value),
		];
		const buildView = (v: ViewConfig): ViewConfig => ({
			...v,
			groupSortDirection: groupState.mode === 'custom' || groupState.mode === 'stable' ? 'asc' : groupState.mode,
			groupSortMode: groupState.mode === 'stable' ? 'stable' : undefined,
			boardColumnOrder: groupState.mode === 'custom' ? groupState.order : undefined,
			swimlaneSortDirection: laneState
				? laneState.mode === 'custom' || laneState.mode === 'stable' ? 'asc' : laneState.mode
				: v.swimlaneSortDirection,
			swimlaneSortMode: laneState?.mode === 'stable' ? 'stable' : undefined,
			boardSwimlaneOrder: laneState?.mode === 'custom' ? laneState.order : undefined,
			cardFields: finalFields(),
			hiddenGroups: hiddenGroups(),
			boardHideEmpty: !showEmpty.checked,
		});
		// Persist the board-wide schema with the chosen types. Excluded props are
		// kept (marked excluded) so auto-adopt does not re-add them later.
		const buildSchema = () => boardSchema.map(prop => ({ ...prop }));
		const buildFullSchema = () => boardSchema.map(prop => ({ ...prop }));
		const boardValues = () => ({
			pageSize: stagedBoard.pageSize,
			colorGroupPanels: stagedBoard.colorGroupPanels,
			cardFontSize: stagedBoard.cardFontSize,
			compactMode: stagedBoard.compactMode,
			createdAtFieldName: stagedBoard.createdAtFieldName,
			updatedAtFieldName: stagedBoard.updatedAtFieldName,
		});

		// Apply the staged config/view/schema/color-rules to a board file.
		// Renames and property deletions are board-specific and only run for the
		// current board.
		const applyToBoard = async (file: TFile) => {
			await this.manager.updateBoardConfig(file, (config: BoardConfig) => ({
				...config,
				...boardValues(),
				colorRules: this.stagedRules.map(r => ({ ...r })),
			}));
			await this.manager.updateViewConfig(file, buildView);
			await this.manager.updateBoardSchema(file, buildSchema());
		};

		const finish = () => {
			this.dirty = false;
			this.close();
			this.onApplied();
		};

		// Full apply to the current board: renames, property deletions, color
		// rules, then config/view/schema.
		const applyCurrentBoard = async () => {
			// Renames first: they rewrite the board config + task files, so they
			// must run before the config/schema/view writes below. The file rename
			// also comes first — the returned TFile (new path) is used for every
			// write that follows, so the board's settings are never lost.
			if (this.pendingBoardRename && this.pendingBoardRename !== this.boardFile.basename) {
				const renamed = await this.manager.renameBoardFile(this.boardFile, this.pendingBoardRename);
				if (renamed) this.boardFile = renamed;
			}
			for (const r of this.pendingRenames) {
				await this.manager.renameTimestampField(this.boardFile, r.kind, r.oldName, r.newName);
			}
			// Property deletions: strip the values from every task file in the
			// board folder (the schema write below drops the definition).
			for (const id of this.pendingRemovals) {
				await this.manager.deleteProperty(this.boardFile, id);
			}
			await applyToBoard(this.boardFile);
			await this.onSaveSettings();
		};

		const doApply = async () => {
			await applyCurrentBoard();
			finish();
		};

		const applyToAll = async () => {
			await applyCurrentBoard();
			const others = this.manager.getAllBoards().filter((b: TFile) => b.path !== this.boardFile.path);
			for (const b of others) {
				await applyToBoard(b);
			}
			finish();
			new Notice(`Applied to ${others.length} other board${others.length === 1 ? '' : 's'}`);
		};

		const overrideAsDefaults = async () => {
			await applyCurrentBoard();
			const s = this.manager.getSettings();
			s.defaultBoardConfig = { schema: buildFullSchema(), views: [buildView(this.view)] };
			s.pageSize = stagedBoard.pageSize;
			s.colorGroupPanels = stagedBoard.colorGroupPanels;
			s.cardFontSize = stagedBoard.cardFontSize;
			s.compactMode = stagedBoard.compactMode;
			s.createdAtFieldName = stagedBoard.createdAtFieldName;
			s.updatedAtFieldName = stagedBoard.updatedAtFieldName;
			s.colorRules = this.stagedRules.map(r => ({ ...r }));
			await this.onSaveSettings();
			finish();
			new Notice('Saved as defaults for new boards');
		};

		// Confirm + run a staged apply, showing the change summary.
		const confirmAndRun = (title: string, lines: string[], run: () => Promise<void>, danger = false) => {
			if (lines.length === 0) {
				void run();
				return;
			}
			new ConfirmModal(this.app, title, lines.join('\n'), () => void run(), 'Apply', undefined, danger).open();
		};

		// Split Apply button: main action + expand menu.
		const applyWrap = footer.createDiv({ cls: 'cc-apply-split' });
		const applyBtn = applyWrap.createEl('button', { text: 'Apply', cls: 'mod-cta' });
		applyBtn.addEventListener('click', () => {
			confirmAndRun('Apply changes?', this.buildSummary(), doApply);
		});

		const menuBtn = applyWrap.createEl('button', { cls: 'cc-apply-menu-btn', title: 'More apply options' });
		setIcon(menuBtn, 'chevron-down');
		const menu = applyWrap.createDiv({ cls: 'cc-apply-menu' });
		const menuItem = (label: string, onClick: () => void) => {
			const item = menu.createEl('button', { text: label, cls: 'cc-apply-menu-item' });
			item.addEventListener('click', () => {
				menu.removeClass('is-open');
				onClick();
			});
			return item;
		};
		menuItem('Apply', () => confirmAndRun('Apply changes?', this.buildSummary(), doApply));
		menuItem('Apply to ALL boards', () => {
			const others = this.manager.getAllBoards().filter((b: TFile) => b.path !== this.boardFile.path).length;
			confirmAndRun(
				'Apply to ALL boards?',
				[...this.buildSummary(), `This board's settings will override ${others} other board${others === 1 ? '' : 's'}. Their current settings will be lost.`],
				applyToAll,
				true
			);
		});
		menuItem('Override as defaults', () => {
			confirmAndRun(
				'Override as defaults?',
				[...this.buildSummary(), 'Saved as the default for new boards.'],
				overrideAsDefaults
			);
		});
		menuBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			menu.toggleClass('is-open', !menu.hasClass('is-open'));
		});
		// Close the menu when clicking anywhere outside it.
		const onDocClick = (e: MouseEvent) => {
			if (!applyWrap.contains(e.target as Node)) menu.removeClass('is-open');
		};
		document.addEventListener('click', onDocClick);
		this.menuCleanup = () => document.removeEventListener('click', onDocClick);
	}

	/** Rename an auto-maintained field for THIS board: prompts for the new
	 *  name, warns that existing instances will be rewritten, stages the
	 *  rename (executed on Apply) and re-renders the Properties pane. */
	private promptRenameAutoField(
		kind: 'createdAt' | 'updatedAt',
		currentName: string,
		stagedBoard: { createdAtFieldName: string; updatedAtFieldName: string },
		refresh: () => void,
		schema: ColumnSchema[]
	): void {
		const label = kind === 'createdAt' ? 'Created At' : 'Updated At';
		new PromptModal(
			this.app,
			`Rename ${label} field`,
			`New frontmatter key for the ${label.toLowerCase()} timestamp.`,
			currentName,
			async (newName) => {
				if (!newName || newName === currentName) return;
				// Warn (with a user action) when the new name collides with an
				// existing property — including one created or renamed earlier in
				// this same session — or with the other auto field.
				const otherAuto = kind === 'createdAt' ? stagedBoard.updatedAtFieldName : stagedBoard.createdAtFieldName;
				const collides = schema.some(p => (p.name ?? p.id) === newName) || newName === otherAuto;
				if (collides) {
					const proceed = await new Promise<boolean>(resolve => {
						new ConfirmModal(
							this.app,
							'Duplicate field name',
							`Another property is already named "${newName}". Two properties with the same name can be confusing. Use it anyway?`,
							() => resolve(true),
							'Use anyway',
							() => resolve(false),
							true
						).open();
					});
					if (!proceed) return;
				}
				const ok = await new Promise<boolean>(resolve => {
					new ConfirmModal(
						this.app,
						'Rename field',
						`All existing "${currentName}" values in this board will be renamed to "${newName}", and new tasks will use it. Continue?`,
						() => resolve(true),
						'Rename',
						() => resolve(false)
					).open();
				});
				if (!ok) return;
				if (kind === 'createdAt') stagedBoard.createdAtFieldName = newName;
				else stagedBoard.updatedAtFieldName = newName;
				// Gather repeated renames of the same field into one pending entry
				// (keep the first old name, update to the latest new name) so the
				// Apply summary shows a single line instead of one per rename.
				const existing = this.pendingRenames.find(r => r.kind === kind);
				if (existing) existing.newName = newName;
				else this.pendingRenames.push({ kind, oldName: currentName, newName });
				this.markDirty();
				refresh();
			}
		).open();
	}

	private markDirty(): void {
		this.dirty = true;
	}

	/** Intercept close (Cancel button, Esc, or the X) to confirm discarding
	 *  unsaved changes. Apply clears `dirty` first so it closes freely. */
	close(): void {
		if (this.dirty && !this.discardConfirmed) {
			this.discardConfirmed = true;
			const summary = this.buildSummary();
			const message = summary.length > 0
				? `You have unsaved changes in this board:\n\n${summary.join('\n')}\n\nClose without applying them?`
				: 'You have unsaved changes in this board. Close without applying them?';
			new ConfirmModal(
				this.app,
				'Discard changes?',
				message,
				() => {
					this.discardConfirmed = true;
					this.close();
				},
				'Discard',
				() => {
					this.discardConfirmed = false;
				}
			).open();
			return;
		}
		super.close();
	}

	private renderSortSection(
		container: HTMLElement,
		values: string[],
		storedOrder: string[],
		initialDirection: 'asc' | 'desc' | undefined,
		initialMode?: 'stable' | 'asc' | 'desc'
	): SortSectionState {
		// Custom order starts from what is actually in the task base:
		// stored (still-existing) values first, then any new values in alpha order.
		const existing = storedOrder.filter(v => values.includes(v));
		// If a custom order was saved, reopen in custom mode so it isn't lost.
		// "Stable" reopens as stable so the live property order is kept dynamic.
		const mode: 'asc' | 'desc' | 'custom' | 'stable' =
			existing.length > 0 ? 'custom' : (initialMode ?? initialDirection ?? 'stable');
		const state: SortSectionState = {
			mode,
			order: existing.length > 0 ? [...existing, ...values.filter(v => !existing.includes(v))] : values,
			values,
		};

		new SettingRow(container, 'Order', 'Stable follows the property\u2019s option order live; Custom lets you reorder; top = leftmost column, bottom = rightmost')
			.addDropdown(state.mode, { stable: 'Stable (property order)', asc: 'Ascending', desc: 'Descending', custom: 'Custom order' }, v => {
				state.mode = v as 'asc' | 'desc' | 'custom' | 'stable';
				this.markDirty();
				listWrap.empty();
				if (state.mode === 'custom') renderList();
			});

		const listWrap = container.createDiv({ cls: 'cc-customize-order' });

		const renderList = () => {
			preserveScroll(listWrap, () => {
				listWrap.empty();
				state.order.forEach((value, index) => {
					const row = listWrap.createDiv({ cls: 'cc-customize-order-row' });
					row.createSpan({ text: value, cls: 'cc-customize-order-value' });
					const up = row.createEl('button', { title: 'Move up (left)' });
					setIcon(up, 'arrow-up');
					up.disabled = index === 0;
					up.addEventListener('click', () => {
						if (index === 0) return;
						const [item] = state.order.splice(index, 1);
						state.order.splice(index - 1, 0, item);
						this.markDirty();
						renderList();
					});
					const down = row.createEl('button', { title: 'Move down (right)' });
					setIcon(down, 'arrow-down');
					down.disabled = index === state.order.length - 1;
					down.addEventListener('click', () => {
						if (index === state.order.length - 1) return;
						const [item] = state.order.splice(index, 1);
						state.order.splice(index + 1, 0, item);
						this.markDirty();
						renderList();
					});
				});
			});
		};

		if (state.mode === 'custom') renderList();
		return state;
	}

	onClose(): void {
		this.menuCleanup?.();
		this.menuCleanup = null;
		this.contentEl.empty();
	}
}

interface SortSectionState {
	mode: 'asc' | 'desc' | 'custom' | 'stable';
	order: string[];
	values: string[];
}

/** Minimal Setting-row helper (avoids the Setting class so re-render is easy). */
class SettingRow {
	private controlEl: HTMLElement;

	constructor(parent: HTMLElement, name: string, desc: string) {
		const wrapEl = parent.createDiv({ cls: 'setting-item' });
		const info = wrapEl.createDiv({ cls: 'setting-item-info' });
		info.createEl('div', { text: name, cls: 'setting-item-name' });
		info.createEl('div', { text: desc, cls: 'setting-item-description' });
		this.controlEl = wrapEl.createDiv({ cls: 'setting-item-control' });
	}

	addDropdown(initial: string, options: Record<string, string>, onChange: (value: string) => void): HTMLSelectElement {
		const select = this.controlEl.createEl('select', { cls: 'dropdown' });
		for (const [value, label] of Object.entries(options)) {
			select.createEl('option', { value, text: label });
		}
		select.value = initial;
		select.addEventListener('change', () => onChange(select.value));
		return select;
	}
}

function distinctValues(tasks: TaskFileSchema[], fieldId: string): string[] {
	const seen = new Set<string>();
	for (const t of tasks) {
		const v = t[fieldId];
		if (v === undefined || v === null || v === '') continue;
		if (Array.isArray(v)) {
			for (const item of v) seen.add(String(item));
		} else {
			seen.add(String(v));
		}
	}
	return [...seen].sort();
}