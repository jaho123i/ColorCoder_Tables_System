import { TFile, WorkspaceLeaf, View, App } from 'obsidian';
import * as React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { TaskFileSchema } from '../types/task-schema';
import { BoardConfig, DEFAULT_BOARD_CONFIG, ColorRule, ViewConfig, DEFAULT_VIEW } from '../types/index';
import BoardView from './BoardView';
import { resolveGroupField } from '../hooks/useBoardData';
import { ErrorBoundary } from './ErrorBoundary';
import { CustomizeBoardModal } from '../modals/CustomizeBoardModal';
import { QuickAddModal } from '../modals/QuickAddModal';
import { BodyPreviewModal } from '../modals/BodyPreviewModal';
import { FieldValueModal } from '../modals/FieldValueModal';
import { inferPropertyType } from '../core/property-types';
import ColorCoderPlugin from '../main';

export const VIEW_TYPE_COLORCODER = 'colorcoder-view';

export class ColorCoderView extends View {
	app: App;
	icon: string = 'table';

	private root: Root | null = null;
	private boardFile: TFile | null = null;
	private tasks: TaskFileSchema[] = [];
	private currentView: ViewConfig = DEFAULT_VIEW;
	private currentConfig: BoardConfig = DEFAULT_BOARD_CONFIG;
	/** Task tabs opened from this board, in order — closed by the back action. */
	private taskLeaves: WorkspaceLeaf[] = [];
	/** Capacitor back-button listener (Android system back); removed on close. */
	private capacitorBackListener: { remove: () => void } | null = null;

	constructor(leaf: WorkspaceLeaf, private plugin: ColorCoderPlugin) {
		super(leaf);
		this.app = plugin?.app ?? null;
	}

	getViewType(): string {
		return VIEW_TYPE_COLORCODER;
	}

	/** The board file this view renders (public so the plugin can scope refreshes). */
	getBoardFile(): TFile | null {
		return this.boardFile;
	}

	getDisplayText(): string {
		return this.boardFile?.basename ?? 'ColorCoder Board';
	}

	async onOpen() {
		const container = this.containerEl;
		container.empty();
		container.addClass('colorcoder-view-container');
		this.root = createRoot(container);
		await this.loadAndRender();

		// Live refresh: re-render when a task file in the board's folder
		// changes (edits, drag&drop, Quick Add) so the board stays in sync.
		// The board file itself is skipped — its own handlers re-render.
		const onFileChanged = (file: TFile) => {
			if (!this.boardFile || !this.app?.vault) return;
			if (file.path === this.boardFile.path) return;
			const folder = this.boardFile.parent?.path ?? '';
			if (!file.path.startsWith(folder)) return;
			void this.loadAndRender();
		};
		this.registerEvent(this.app.vault.on('modify', onFileChanged));
		this.registerEvent(this.app.vault.on('create', onFileChanged));
		this.registerEvent(this.app.vault.on('delete', onFileChanged));
		this.registerEvent(this.app.vault.on('rename', (file: TFile, oldPath: string) => {
			// The board file itself was renamed (Customize → General): adopt the
			// new TFile so the view keeps reading the board's real config instead
			// of falling back to defaults on a stale path.
			if (this.boardFile && oldPath === this.boardFile.path) {
				this.boardFile = file;
				void this.loadAndRender();
				return;
			}
			onFileChanged(file);
		}));

		// Back navigation: close the most recent task tab and return to the
		// board. Two back sources:
		//  - PC: the mouse side back button fires `popstate`.
		//  - Android: the system back button does NOT reliably fire popstate
		//    (Obsidian mobile is a Capacitor app), so we also listen to
		//    Capacitor's backButton event.
		this.registerDomEvent(window, 'popstate', () => {
			this.closeTaskTab();
		});
		const capacitorApp = (window as unknown as { Capacitor?: { Plugins?: { App?: { addListener: (event: string, callback: () => void) => { remove: () => void } } } } })?.Capacitor?.Plugins?.App;
		if (capacitorApp?.addListener) {
			this.capacitorBackListener = capacitorApp.addListener('backButton', () => {
				this.closeTaskTab();
			});
		}
	}

	/** Close the most recent task tab opened from this board. Returns true if
	 *  one was closed (stale leaves — already detached by the user — are skipped). */
	private closeTaskTab(): boolean {
		while (this.taskLeaves.length > 0) {
			const leaf = this.taskLeaves.pop()!;
			try {
				if (leaf.view) {
					leaf.detach();
					return true;
				}
			} catch {
				// Leaf already detached (user closed the tab manually) — try the next.
			}
		}
		return false;
	}

	onClose(): Promise<void> {
		this.capacitorBackListener?.remove?.();
		this.capacitorBackListener = null;
		this.taskLeaves = [];
		this.root?.unmount();
		this.root = null;
		return Promise.resolve();
	}

	getState(): Record<string, unknown> {
		return {
			type: this.getViewType(),
			boardFilePath: this.boardFile?.path ?? null,
		};
	}

	async setState(state: { boardFilePath?: string | null } | null | undefined, _result?: unknown): Promise<void> {
		if (state?.boardFilePath) {
			const file = this.app?.vault?.getFileByPath(state.boardFilePath) ?? null;
			if (file) await this.setBoardFile(file);
		}
	}

	async setBoardFile(file: TFile | null): Promise<void> {
		this.boardFile = file;
		await this.loadAndRender();
	}

	/** Public reload used by the plugin to refresh all boards after settings change. */
	async refresh(): Promise<void> {
		await this.loadAndRender();
	}

	getBoardFilePath(): string | null {
		return this.boardFile?.path ?? null;
	}

	/** Load tasks and re-render the board */
	private async loadAndRender(): Promise<void> {
		const manager = this.plugin?.manager;

		if (!this.boardFile) {
			this.renderLoading();
			return;
		}

		const tasks: TaskFileSchema[] = [];
		let config: BoardConfig = DEFAULT_BOARD_CONFIG;

		try {
			if (manager) {
				const result = await manager.getTasksForBoard(this.boardFile);
				if (result.success && result.data) {
					tasks.push(...result.data);
				}
				config = await manager.readConfig(this.boardFile);
			}
		} catch {
			// Load failure is non-fatal; board will render empty.
		}

		this.tasks = tasks;
		this.renderBoard(config);
	}

	private renderLoading(): void {
		if (!this.root) return;
		this.root.render(React.createElement('div', { className: 'board-empty' }, 'Loading…'));
	}

	private async handleGroupByChange(property: string): Promise<void> {
		if (!this.boardFile) return;
		const manager = this.plugin?.manager;
		await manager?.updateViewConfig(this.boardFile, (view: ViewConfig) => ({
			...view,
			groupByColumnId: property,
		}));
		await this.loadAndRender();
	}

	private async handleSwimlaneByChange(property: string): Promise<void> {
		if (!this.boardFile) return;
		const manager = this.plugin?.manager;
		await manager?.updateViewConfig(this.boardFile, (view: ViewConfig) => ({
			...view,
			swimlaneColumnId: property,
		}));
		await this.loadAndRender();
	}

	private async handleToggleColumnHidden(columnId: string): Promise<void> {
		if (!this.boardFile) return;
		const manager = this.plugin?.manager;
		const hidden = new Set(this.currentView.hiddenGroups ?? []);
		if (hidden.has(columnId)) hidden.delete(columnId);
		else hidden.add(columnId);
		const newView: ViewConfig = { ...this.currentView, hiddenGroups: [...hidden] };
		await manager?.updateViewConfig(this.boardFile, () => newView);
		// Hiding a group only changes the view — the tasks are untouched, so
		// re-render from the already-loaded tasks instead of re-reading every
		// task file (which is what made hiding feel slow).
		this.currentView = newView;
		this.currentConfig = { ...this.currentConfig, views: [newView] };
		this.renderBoard(this.currentConfig);
	}

	private openCustomize(): void {
		if (!this.boardFile) return;
		const manager = this.plugin?.manager;
		const view: ViewConfig = this.currentView;
		// Board schema wins; otherwise fall back to the default properties from Settings.
		const schema =
			this.currentConfig?.schema && this.currentConfig.schema.length > 0
				? this.currentConfig.schema
				: (this.plugin?.settings?.defaultBoardConfig?.schema ?? []);
		new CustomizeBoardModal(
			this.app,
			manager,
			this.boardFile,
			view,
			schema,
			this.tasks,
			manager?.getAvailableProperties(this.tasks) ?? [],
			this.currentConfig?.colorRules ?? [],
			this.currentConfig,
			() => this.plugin?.saveSettings(),
			() => void this.loadAndRender()
		).open();
	}

	private async openQuickAdd(config: BoardConfig): Promise<void> {
		if (!this.boardFile) return;
		const manager = this.plugin?.manager;
		// Board schema wins; otherwise fall back to the properties defined in Settings.
		const schema =
			config.schema && config.schema.length > 0
				? config.schema
				: (this.plugin?.settings?.defaultBoardConfig?.schema ?? []);
		const fieldNames = await manager?.getEffectiveFieldNames(this.boardFile, config);
		new QuickAddModal(this.app, manager, this.boardFile, schema, undefined, fieldNames).open();
	}

	private async openTaskFile(task: TaskFileSchema): Promise<void> {
		if (!this.app) return;
		const file = this.app.vault?.getFileByPath(task._file);
		if (file) {
			// Always open in a new tab so the board leaf stays alive — the
			// system back action (Android) / mouse side back (PC) then returns
			// to the board (see the popstate handler in onOpen).
			const leaf = this.app.workspace.getLeaf('tab');
			// Seed the new leaf's navigation history with the board view so
			// Obsidian's OWN back handler navigates back to the board instead
			// of ALSO showing its "press back again to close the app" prompt
			// (which fires alongside our Capacitor listener).
			await leaf.setViewState(
				{ type: VIEW_TYPE_COLORCODER, state: { boardFilePath: this.boardFile?.path ?? null } },
				{ history: true }
			);
			await leaf.openFile(file);
			this.taskLeaves.push(leaf);
			history.pushState({ colorcoder: 'task' }, '');
		}
	}

	private openBodyPreview(task: TaskFileSchema): void {
		if (!this.app) return;
		new BodyPreviewModal(this.app, task).open();
	}

	/** Edit a card property's value inline (clicked a pill on the tile). */
	private openFieldValue(task: TaskFileSchema, field: string, config: BoardConfig): void {
		if (!this.app || !this.boardFile) return;
		// Board schema wins (type + options); otherwise infer the type from the
		// current value so the editor still picks the right control.
		const prop =
			config.schema?.find(c => c.id === field) ??
			{ id: field, name: field, type: inferPropertyType(task[field]), visible: true };
		new FieldValueModal(this.app, this.plugin?.manager, this.boardFile, task, prop).open();
	}

	private renderBoard(config: BoardConfig = DEFAULT_BOARD_CONFIG): void {
		if (!this.root) return;

		const manager = this.plugin?.manager;
		// Merge loaded view with DEFAULT_VIEW to ensure all defaults (e.g. boardHideEmpty)
		// are present even for boards created before the field was added.
		// Explicitly default boardHideEmpty to false (show empty groups) unless the
		// loaded view has it explicitly set to true.
		const loadedView = config.views?.[0];
		const view: ViewConfig = loadedView
			? { ...DEFAULT_VIEW, ...loadedView, boardHideEmpty: loadedView.boardHideEmpty === true }
			: DEFAULT_VIEW;
		this.currentView = view;
		this.currentConfig = config;
		const colorRules: ColorRule[] = config.colorRules ?? [];
		const properties = manager?.getAvailableProperties(this.tasks) ?? [];
		// Option order of the group-by property, for "Stable" column ordering.
		const groupByColumnId = resolveGroupField(view, properties);
		const groupSchema = config.schema?.find(c => c.id === groupByColumnId);
		const propertyOptions = groupSchema?.options?.map(o => o.value);
		// Per-board General settings (snapshotted at board creation). The plugin
		// settings only seed new boards — they never override an existing board.
		const pageSize = config.pageSize ?? 50;
		const colorGroupPanels = config.colorGroupPanels ?? false;
		const cardFontSize = config.cardFontSize ?? 14;
		const compactMode = config.compactMode ?? this.plugin?.settings?.compactMode ?? false;

		this.root.render(
			React.createElement(
				ErrorBoundary,
				null,
				React.createElement(BoardView, {
					tasks: this.tasks,
					boardConfig: config,
					view,
					colorRules,
					properties,
					pageSize,
					colorGroupPanels,
					cardFontSize,
					compactMode,
					propertyOptions,
					onGroupByChange: (property: string) => void this.handleGroupByChange(property),
					onSwimlaneByChange: (property: string) => void this.handleSwimlaneByChange(property),
					onToggleColumnHidden: (columnId: string) => void this.handleToggleColumnHidden(columnId),
					onCustomize: () => void this.openCustomize(),
					onAddTask: () => void this.openQuickAdd(config),
					onCardClick: (task: TaskFileSchema) => void this.openTaskFile(task),
					onBodyPreview: (task: TaskFileSchema) => void this.openBodyPreview(task),
					onFieldClick: (task: TaskFileSchema, field: string) => void this.openFieldValue(task, field, config),
					onMoveTask: async (taskFile: string, toColumnId: string, beforeTaskFile?: string | null, swimlaneId?: string): Promise<void> => {
						if (!this.boardFile || !manager) return;
						// Column ids are `${groupByField}:${value}`; write the target
						// value to the same field that produced the column.
						let field = groupByColumnId;
						let value = toColumnId;
						if (toColumnId.startsWith('__ungrouped__:')) {
							// Dropping on "Ungrouped": clear the group field.
							field = toColumnId.slice('__ungrouped__:'.length);
							value = '';
						} else if (toColumnId.includes(':')) {
							field = toColumnId.slice(0, toColumnId.indexOf(':'));
							value = toColumnId.slice(toColumnId.indexOf(':') + 1);
						}
						// If dropped into a swimlane, also update the swimlane field.
						let swimlaneField: string | undefined;
						let swimlaneValue: string | undefined;
						if (swimlaneId) {
							if (swimlaneId.startsWith('__ungrouped__:')) {
								swimlaneField = swimlaneId.slice('__ungrouped__:'.length);
								swimlaneValue = '';
							} else if (swimlaneId.includes(':')) {
								swimlaneField = swimlaneId.slice(0, swimlaneId.indexOf(':'));
								swimlaneValue = swimlaneId.slice(swimlaneId.indexOf(':') + 1);
							}
						}
						// Persist per-group card order: remove the task from every
						// group's order, then insert it before the drop target (or
						// at the bottom when dropped on the header/empty space).
						const order = { ...(this.currentView.boardTaskOrder ?? {}) };
						for (const key of Object.keys(order)) {
							order[key] = order[key].filter(f => f !== taskFile);
						}
						// Seed the target column's order with every task currently
						// in it, so the drop position resolves even when the target
						// card was never explicitly ordered (otherwise indexOf
						// returns -1 and the card lands at the bottom).
						const inColumn = this.tasks
							.filter(t => {
								const v = t[field];
								return value === ''
									? (v === undefined || v === null || v === '')
									: String(v) === value;
							})
							.map(t => t._file);
						const current = order[toColumnId] ?? [];
						const full = [...current, ...inColumn.filter(f => !current.includes(f))];
						const idx = beforeTaskFile ? full.indexOf(beforeTaskFile) : -1;
						order[toColumnId] =
							idx >= 0
								? [...full.slice(0, idx), taskFile, ...full.slice(idx)]
								: [...full, taskFile];
						// Optimistic local update: modify the task in-memory so the
						// board re-renders instantly without a full reload.
						const taskIdx = this.tasks.findIndex(t => t._file === taskFile);
						if (taskIdx >= 0) {
							const updatedTask = { ...this.tasks[taskIdx] };
							updatedTask[field] = value;
							if (swimlaneField && swimlaneValue !== undefined) {
								updatedTask[swimlaneField] = swimlaneValue;
							}
							this.tasks[taskIdx] = updatedTask;
						}
						// Update local view config for immediate re-render.
						this.currentView = { ...this.currentView, boardTaskOrder: order };
						// Persist to disk — AWAIT the field updates so the optimistic
						// state doesn't get reverted by a re-render before the write completes.
						await manager.updateViewConfig(this.boardFile, (v: ViewConfig) => ({
							...v,
							boardTaskOrder: order,
						}));
						await manager.updateTaskField(this.boardFile, taskFile, field, value);
						if (swimlaneField && swimlaneValue !== undefined) {
							await manager.updateTaskField(this.boardFile, taskFile, swimlaneField, swimlaneValue);
						}
						// Re-render with updated local state.
						this.renderBoard(this.currentConfig);
					},
			}
		)
		)
	);
	}
}
