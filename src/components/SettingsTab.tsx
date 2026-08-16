import { App, PluginSettingTab, Notice } from 'obsidian';
import { ColumnSchema } from '../types/index';
import { renderColorRulesTab, renderPropertiesTab, renderGeneralTab, preserveScroll } from './shared/property-ui';
import { PromptModal } from '../modals/PromptModal';
import { ConfirmModal } from '../modals/ConfirmModal';

const DEFAULT_DATABASE_FILE_NAME = 'ColorCoder-board';

const DEFAULT_PROPERTY: Omit<ColumnSchema, 'id'> = {
	name: 'New property',
	type: 'text',
	visible: true,
};

export class ColorCoderSettingTab extends PluginSettingTab {
	plugin: any;

	// Settings are split into submenu tabs; Properties holds the *default*
	// property definitions that new boards inherit.
	private activeTab: 'general' | 'properties' | 'colors' = 'general';

	constructor(app: App, plugin: any) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		// Preserve scroll position across re-renders (e.g. adding a rule),
		// so the page doesn't jump back to the top. A render error in one tab
		// must not block switching to the others.
		preserveScroll(containerEl, () => {
			containerEl.empty();
			try {
				this.renderBody(containerEl);
			} catch (err) {
				containerEl.createDiv({ text: `Settings error: ${(err as Error)?.message ?? err}`, cls: 'setting-item-description' });
			}
		});
	}

	private renderBody(containerEl: HTMLElement): void {
		containerEl.createEl('h2', { text: 'ColorCoder Tables' });

		// ── Submenu tab bar ─────────────────────────────────────
		const tabs = containerEl.createDiv({ cls: 'cc-settings-tabs' });
		const renderTabButton = (id: 'general' | 'properties' | 'colors', label: string, suffix?: string) => {
			const btn = tabs.createEl('button', { cls: 'cc-settings-tab' });
			if (this.activeTab === id) btn.addClass('is-active');
			btn.createSpan({ text: label });
			// "(default)" is de-emphasized: 50% font size, 80% opacity so the
			// tab titles don't read as one long label.
			if (suffix) btn.createSpan({ text: suffix, cls: 'cc-tab-suffix' });
			btn.addEventListener('click', () => {
				this.activeTab = id;
				this.display();
			});
		};
		renderTabButton('general', 'General', '(default)');
		renderTabButton('properties', 'Properties', '(default)');
		renderTabButton('colors', 'Color Rules', '(default)');

		if (this.activeTab === 'general') this.renderGeneralTab(containerEl);
		else if (this.activeTab === 'properties') this.renderPropertiesTab(containerEl);
		else this.renderColorRulesTab(containerEl);
	}

	private renderGeneralTab(containerEl: HTMLElement): void {
		// Shared with the board Customize → View tab; here it edits the plugin
		// defaults (new boards inherit them).
		renderGeneralTab(containerEl, {
			databaseFileName: this.plugin.settings?.databaseFileName ?? DEFAULT_DATABASE_FILE_NAME,
			onDatabaseFileNameChange: async (name) => {
				this.plugin.settings.databaseFileName = name;
				await this.plugin.saveSettings();
			},
			pageSize: this.plugin.settings?.pageSize ?? 50,
			onPageSizeChange: async (n) => {
				this.plugin.settings.pageSize = n;
				await this.plugin.saveSettings();
			},
			colorGroupPanels: this.plugin.settings?.colorGroupPanels ?? false,
			onColorGroupPanelsChange: async (v) => {
				this.plugin.settings.colorGroupPanels = v;
				await this.plugin.saveSettings();
			},
			cardFontSize: this.plugin.settings?.cardFontSize ?? 14,
			onCardFontSizeChange: async (n) => {
				this.plugin.settings.cardFontSize = n;
				await this.plugin.saveSettings();
			},
			compactMode: this.plugin.settings?.compactMode ?? false,
			onCompactModeChange: async (v) => {
				this.plugin.settings.compactMode = v;
				await this.plugin.saveSettings();
			},
		});

		// Plugin-level General settings are defaults for new boards — offer the
		// same "push them to every existing board" action as the other tabs.
		this.renderApplyBar(containerEl);
	}

	/** Rename a global auto-maintained field (Settings context): updates the
	 *  default key used for new tasks; existing files are not rewritten. */
	private promptRenameAutoField(kind: 'createdAt' | 'updatedAt', currentName: string): void {
		const label = kind === 'createdAt' ? 'Created At' : 'Updated At';
		new PromptModal(
			this.app,
			`Rename ${label} field`,
			`New frontmatter key for the ${label.toLowerCase()} timestamp.`,
			currentName,
			async (newName) => {
				if (!newName || newName === currentName) return;
				// Warn (with a user action) when the new name collides with an
				// existing property or with the other auto field.
				const schema = this.plugin.settings?.defaultBoardConfig?.schema ?? [];
				const otherAuto = kind === 'createdAt'
					? (this.plugin.settings?.updatedAtFieldName ?? 'Updated At')
					: (this.plugin.settings?.createdAtFieldName ?? 'Created At');
				const collides = schema.some((p: ColumnSchema) => (p.name ?? p.id) === newName) || newName === otherAuto;
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
						`New tasks will stamp the ${label.toLowerCase()} timestamp under "${newName}" instead of "${currentName}". Existing files are not changed. Continue?`,
						() => resolve(true),
						'Rename',
						() => resolve(false)
					).open();
				});
				if (!ok) return;
				if (kind === 'updatedAt') {
					this.plugin.settings.updatedAtFieldName = newName;
					const schema = this.plugin.settings?.defaultBoardConfig?.schema ?? [];
					const lastEdit = schema.find((p: ColumnSchema) => p.type === 'lastEdit');
					if (lastEdit) {
						lastEdit.id = newName;
						lastEdit.fieldName = newName;
					}
				} else {
					this.plugin.settings.createdAtFieldName = newName;
				}
				await this.plugin.saveSettings();
				new Notice(`"${currentName}" renamed to "${newName}" for new tasks`);
				this.display();
			}
		).open();
	}

	private renderPropertiesTab(containerEl: HTMLElement): void {
		const manager = this.plugin?.manager;

		// Auto-adopt every vault property into the default schema (no manual
		// "Add" step), then render the shared Properties tab with the stats.
		const render = (stats?: { key: string; count: number; values: string[]; type: string }[]) => {
			renderPropertiesTab(this.app, containerEl, {
				schema: this.plugin.settings?.defaultBoardConfig?.schema ?? [],
				title: 'Properties (default)',
				description: 'Every property found in your vault is added automatically — no manual setup. These definitions become the default for new boards; each board can override them from Customize → Properties. Created At and Updated At are auto-maintained timestamps.',
				getStat: prop => stats?.find(s => s.key === prop.id),
				onChange: () => this.plugin.saveSettings(),
				onToggleHide: (prop) => {
					prop.excluded = !prop.excluded;
					void this.plugin.saveSettings();
					this.display();
				},
				onRemove: (prop) => {
					this.plugin.settings.defaultBoardConfig.schema =
						this.plugin.settings.defaultBoardConfig.schema.filter(
							(p: ColumnSchema) => p.id !== prop.id
						);
					this.plugin.settings.excludedProperties = [
						...(this.plugin.settings.excludedProperties ?? []),
						prop.id,
					];
					void this.plugin.saveSettings();
					void manager?.deletePropertyVaultWide(prop.id);
					this.display();
				},
				onAdd: () => {
					const newProp: ColumnSchema = {
						...DEFAULT_PROPERTY,
						id: `prop-${Date.now()}`,
					};
					this.plugin.settings.defaultBoardConfig.schema.push(newProp);
					void this.plugin.saveSettings();
					this.display();
				},
				refresh: () => this.display(),
				autoFields: {
					createdAt: {
						enabled: this.plugin.settings?.autoUpdateCreatedAt !== false,
						fieldName: this.plugin.settings?.createdAtFieldName ?? 'Created At',
						onChange: async (v) => {
							this.plugin.settings.autoUpdateCreatedAt = v;
							await this.plugin.saveSettings();
						},
						onRename: (currentName) => this.promptRenameAutoField('createdAt', currentName),
					},
					updatedAt: {
						enabled: this.plugin.settings?.autoUpdateUpdatedAt !== false,
						fieldName: this.plugin.settings?.updatedAtFieldName ?? 'Updated At',
						onChange: async (v) => {
							this.plugin.settings.autoUpdateUpdatedAt = v;
							await this.plugin.saveSettings();
						},
						onRename: (currentName) => this.promptRenameAutoField('updatedAt', currentName),
					},
				},
			});
			this.renderApplyBar(containerEl);
		};

		if (manager?.getVaultPropertyStats) {
			const fieldNames = {
				createdAt: this.plugin.settings?.createdAtFieldName ?? 'Created At',
				updatedAt: this.plugin.settings?.updatedAtFieldName ?? 'Updated At',
			};
			void manager.getVaultPropertyStats(fieldNames).then(async (stats: { key: string; count: number; values: string[]; type: string }[]) => {
				const schema: ColumnSchema[] = this.plugin.settings?.defaultBoardConfig?.schema ?? [];
				const existing = new Set(schema.map(p => p.id));
				const excluded = new Set(this.plugin.settings?.excludedProperties ?? []);
				let changed = false;
				for (const stat of stats) {
					if (existing.has(stat.key)) continue;
					if (excluded.has(stat.key)) continue;
const adoptedType: ColumnSchema['type'] =
					stat.type === 'checkbox' ? 'checkbox'
					: stat.type === 'number' ? 'number'
					: stat.type === 'date' || stat.type === 'datetime' ? 'date'
					: stat.type === 'multiselect' ? 'multiselect'
					: 'text';
				schema.push({
					...DEFAULT_PROPERTY,
					id: stat.key,
					name: stat.key,
					type: adoptedType,
					// Date & time is one type now — a datetime value just sets the
					// "Include time" flag on the merged Date type.
					withTime: stat.type === 'datetime' ? true : undefined,
				});
					changed = true;
				}
				if (changed) {
					this.plugin.settings.defaultBoardConfig.schema = schema;
					await this.plugin.saveSettings();
				}
				render(stats);
			});
		} else {
			render(undefined);
		}
	}

	/** Save + refresh every open board so property/rule changes apply live. */
	private renderApplyBar(containerEl: HTMLElement): void {
		// Same look as the Customize modal's Apply button (mod-cta in a
		// modal-button-container bar) so the two surfaces feel identical.
		const bar = containerEl.createDiv({ cls: 'cc-apply-bar modal-button-container' });
		const btn = bar.createEl('button', { text: 'Apply to ALL boards', cls: 'mod-cta' });
		btn.addEventListener('click', () => {
			const count = this.plugin.manager?.getAllBoards?.().length ?? 0;
			new ConfirmModal(
				this.app,
				'Apply to ALL boards?',
				`Override ${count} board${count === 1 ? '' : 's'} with these plugin defaults (schema, view, per-board settings and color rules)? Their current settings will be lost.`,
				async () => {
					const n = await this.plugin.manager?.applyDefaultsToAllBoards();
					await this.plugin.saveSettings();
					this.plugin.refreshAllBoards?.();
					new Notice(`Applied to ${n ?? 0} board${n === 1 ? '' : 's'}`);
				},
				'Apply',
				undefined,
				true
			).open();
		});
	}

	private renderColorRulesTab(containerEl: HTMLElement): void {
		// Built-in defaults (the Priority color source) become visible and
		// editable the first time this tab is opened. The shared renderer
		// handles that (seedDefaults), the list, and Add buttons.
		const settings = this.plugin.settings;
		renderColorRulesTab(this.app, containerEl, {
			rules: settings?.colorRules ?? [],
			properties: settings?.defaultBoardConfig?.schema ?? [],
			onChange: () => this.plugin.saveSettings(),
			refresh: () => this.display(),
			seedDefaults: true,
			description: 'Default color rules for NEW boards (existing boards keep their own rules). Cards are colored by the first matching rule (highest priority first). The built-in priority defaults below are the source of the Priority color coding — they are used until you edit, remove, or add your own rules.',
		});

		this.renderApplyBar(containerEl);
	}
}