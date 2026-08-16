import { MarkdownView, Notice, Plugin, TFolder, TFile, WorkspaceLeaf } from 'obsidian';
import { ColorCoderView, VIEW_TYPE_COLORCODER } from './components/ColorCoderView';
import { ColorCoderManager } from './core/ColorCoderManager';
import { DEFAULT_SETTINGS, ColorCoderSettings, ColorCoderSettingTab } from './settings';
import { ColorCoderPickerModal } from './modals/ColorCoderPickerModal';
import { QuickAddModal } from './modals/QuickAddModal';
import { openCreateBoardPicker } from './modals/FolderPickerModal';
import { NotionImportModal } from './modals/NotionImportModal';

export default class ColorCoderPlugin extends Plugin {
	settings: ColorCoderSettings;
	manager: ColorCoderManager;

	private _redirecting = false;

	async onload() {
		await this.loadSettings();
		this.manager = new ColorCoderManager(this.app, this.settings.databaseFileName, this.settings);

		// One-time migration: boards created before per-board color rules existed
		// have no snapshot — copy the current global rules into them so later
		// global changes (e.g. deleting a rule) never affect existing boards.
		try {
			await this.manager.migrateBoardColorRules();
		} catch (e) {
			console.error('ColorCoder: color-rule migration failed', e);
		}

		this.registerView(
			VIEW_TYPE_COLORCODER,
			leaf => new ColorCoderView(leaf, this)
		);

		this.addRibbonIcon('table', 'ColorCoder Tables', () => {
			this.openColorCoderPicker();
		});

		this.addCommand({
			id: 'open-colorcoder',
			name: 'Open ColorCoder Board',
			callback: async () => {
				await this.openOrCreateBoard();
			},
		});

		this.addCommand({
			id: 'create-colorcoder',
			name: 'Create ColorCoder Board',
			callback: () => {
				openCreateBoardPicker(this.app, async folderPath => {
					await this.createAndOpenBoard(folderPath);
				});
			},
		});

		this.addCommand({
			id: 'import-notion-export',
			name: 'Import Notion Export',
			callback: () => {
				new NotionImportModal(this.app, this.manager).open();
			},
		});

		this.addCommand({
			id: 'quick-add-task',
			name: 'Quick Add Task',
			callback: () => {
				this.openQuickAdd();
			},
		});

		this.registerEvent(
			this.app.workspace.on('active-leaf-change', async leaf => {
				if (!leaf || this._redirecting) return;
				if (leaf.view.getViewType() !== 'markdown') return;

				const file = (leaf.view as MarkdownView).file ?? undefined;
				if (!file || !this.manager.isBoardFile(file)) return;

				const existingLeaf = this.findBoardLeaf(file.path);
				if (existingLeaf && existingLeaf !== leaf) {
					void this.app.workspace.revealLeaf(existingLeaf);
					leaf.detach();
					return;
				}

				if (!existingLeaf) {
					this._redirecting = true;
					try {
						await this.openBoardInLeaf(leaf, file);
					} finally {
						this._redirecting = false;
					}
				}
			})
		);

		// Fix the file-menu event by handling the import properly
		this.registerEvent(
			this.app.workspace.on('file-menu', async (menu, abstractFile) => {
				if (!(abstractFile instanceof TFolder)) return;
				if (this.manager.getBoardFileInFolder(abstractFile.path)) return;
				menu.addItem(item => {
					item
						.setTitle('Create ColorCoder board here')
						.setIcon('table')
						.onClick(async () => {
							await this.createAndOpenBoard(abstractFile.path);
						});
				});
			})
		);

		this.addSettingTab(new ColorCoderSettingTab(this.app, this));

		// Plugin-level fallback: refresh ALL open boards when any task file changes.
		// Simpler and more reliable than folder matching.
		const refreshOnTaskChange = (file: TFile) => {
			if (this.manager.isBoardFile(file)) return;
			if (!file.path.toLowerCase().endsWith('.md')) return;
			this.app.workspace.iterateAllLeaves(leaf => {
				if (leaf.view instanceof ColorCoderView) {
					void (leaf.view as ColorCoderView).refresh();
				}
			});
		};
		this.registerEvent(this.app.vault.on('modify', refreshOnTaskChange));
		this.registerEvent(this.app.vault.on('create', refreshOnTaskChange));
		this.registerEvent(this.app.vault.on('delete', refreshOnTaskChange));
		this.registerEvent(this.app.vault.on('rename', (file: TFile, oldPath: string) => {
			// Handle board file rename
			this.app.workspace.iterateAllLeaves(leaf => {
				if (leaf.view instanceof ColorCoderView) {
					const boardFile = (leaf.view as ColorCoderView).getBoardFile();
					if (boardFile && oldPath === boardFile.path) {
						(leaf.view as ColorCoderView).setBoardFile(file);
					}
				}
			});
		}));
	}

	onunload() {
		// Cleanup if needed
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<ColorCoderSettings>
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/** Re-render every open board so schema/color-rule changes apply live. */
	refreshAllBoards() {
		this.app.workspace.iterateAllLeaves(leaf => {
			if (leaf.view instanceof ColorCoderView) {
				void (leaf.view as ColorCoderView).refresh();
			}
		});
	}

	openQuickAdd() {
		const boards = this.manager.getAllBoards()
			.sort((a, b) => (a.parent?.path ?? '').localeCompare(b.parent?.path ?? ''));

		if (boards.length === 0) {
			new Notice('No ColorCoder boards found');
			return;
		}

		new ColorCoderPickerModal(this.app, boards, async file => {
			const config = await this.manager.readConfig(file);
			const fieldNames = await this.manager.getEffectiveFieldNames(file, config);
			new QuickAddModal(this.app, this.manager, file, config.schema, undefined, fieldNames).open();
		}).open();
	}

	openColorCoderPicker() {
		const boards = this.manager.getAllBoards()
			.sort((a, b) => (a.parent?.path ?? '').localeCompare(b.parent?.path ?? ''));

		if (boards.length === 0) {
			new Notice('No ColorCoder boards found');
			return;
		}

		new ColorCoderPickerModal(this.app, boards, file => {
			const existingLeaf = this.findBoardLeaf(file.path);
			if (existingLeaf) {
				void this.app.workspace.revealLeaf(existingLeaf);
				return;
			}
			const leaf = this.app.workspace.getLeaf('tab');
			void this.openBoardInLeaf(leaf, file);
		}).open();
	}

	async openOrCreateBoard() {
		const activeFile = this.app.workspace.getActiveFile();
		let folderPath = activeFile?.parent?.path ?? '';

		if (!activeFile) {
			const activeLeaf = this.app.workspace.getActiveViewOfType(ColorCoderView)?.leaf ?? null;
			if (activeLeaf?.view instanceof ColorCoderView) {
				const boardPath = activeLeaf.view.getBoardFilePath();
				if (!boardPath) return;
				const boardFile = this.app.vault.getFileByPath(boardPath);
				folderPath = boardFile?.parent?.path ?? '';
			}
		}

		const existing = this.manager.getBoardFileInFolder(folderPath);

		if (existing) {
			const existingLeaf = this.findBoardLeaf(existing.path);
			if (existingLeaf) {
				void this.app.workspace.revealLeaf(existingLeaf);
				return;
			}
			const leaf = this.app.workspace.getLeaf('tab');
			await this.openBoardInLeaf(leaf, existing);
		} else {
			await this.createAndOpenBoard(folderPath);
		}
	}

	async createAndOpenBoard(folderPath: string) {
		try {
			const boardFile = await this.manager.createBoard(folderPath);
			const leaf = this.app.workspace.getLeaf('tab');
			await this.openBoardInLeaf(leaf, boardFile);
		} catch (e) {
			new Notice(String(e));
		}
	}

	async openBoardInLeaf(leaf: WorkspaceLeaf, file: TFile) {
		await leaf.setViewState({
			type: VIEW_TYPE_COLORCODER,
			state: { boardFilePath: file.path },
			active: true,
		});
		void this.app.workspace.revealLeaf(leaf);

		// setViewState already restores the file via the view's setViewState;
		// ensure the view holds it directly in case state restoration was skipped
		const view = leaf.view;
		if (view instanceof ColorCoderView && view.getBoardFilePath() !== file.path) {
			await view.setBoardFile(file);
		}
	}

	private findBoardLeaf(filePath: string): WorkspaceLeaf | null {
		let found: WorkspaceLeaf | null = null;
		this.app.workspace.iterateAllLeaves(leaf => {
			if (found) return;
			if (leaf.view.getViewType() !== VIEW_TYPE_COLORCODER) return;
			const state = leaf.view.getState() as { boardFilePath?: string };
			if (state.boardFilePath === filePath) found = leaf;
		});
		return found;
	}
}