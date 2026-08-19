import { TFile, TFolder, App } from 'obsidian';
import { BoardConfig, DEFAULT_BOARD_CONFIG, ViewConfig, DEFAULT_VIEW, ColumnSchema } from '../types/index';
import { TaskFileManager, FieldNames } from './task-file-manager';
import { PluginSettings } from '../types/plugin-settings';
import { TaskFileFrontmatter, TaskFileSchema } from '../types/task-schema';
import { inferPropertyType } from './property-types';

const BOARD_FILE_SUFFIX = '-board.md';

/**
 * Canonical keys injected by readTask that are NOT real properties in the
 * vault (they are pure inventions on every task). They clutter property
 * pickers, so they are hidden from every property list. Board config keys
 * (schema, views, colorRules, …) are NOT listed here — board files are
 * excluded from every scan (see getTasksForBoard / getVaultPropertyStats), so
 * their frontmatter never reaches the property list. `updatedAt` is kept: it
 * is a real auto-maintained field.
 */
const HALLUCINATED_KEYS = new Set([
	'id', 'title', 'createdAt', 'updatedAt',
]);

/** Minimal YAML scalar parse for the vault stats scan (frontmatter values are single-line). */
function parseScalar(value: string): unknown {
	const trimmed = value.trim();
	if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1);
	if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
	if (trimmed === 'true') return true;
	if (trimmed === 'false') return false;
	if (trimmed === 'null' || trimmed === '~') return null;
	if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
		return trimmed
			.slice(1, -1)
			.split(',')
			.map(v => parseScalar(v.trim()))
			.filter(v => v !== '' && v !== null);
	}
	// Never coerce numbers here — we want display values, not math.
	return trimmed;
}

export class ColorCoderManager {
	private readonly taskFileManager: TaskFileManager;
	private readonly settings: PluginSettings;

	constructor(private app: App, private databaseFileName: string, settings?: PluginSettings) {
		this.settings = settings ?? emptySettings();
		this.taskFileManager = new TaskFileManager({ app, settings: this.settings });
	}

	/** Access to plugin settings for UI components that need to read/write them. */
	getSettings(): PluginSettings {
		return this.settings;
	}

	/** Resolved database file base name. An empty global setting means "use the
	 *  default" — it must NOT fall back to the name the plugin loaded with,
	 *  otherwise clearing the field would keep using the last-used name. */
	private getDatabaseFileName(): string {
		return (this.settings?.databaseFileName || 'ColorCoder-board')
			.replace(/\.json$/i, '')
			.replace(/\.md$/i, '');
	}

	isBoardFile(file: TFile): boolean {
		// A board file is named exactly after the configured database file name
		// (e.g. "MyBoard.md"), OR is a legacy "-board.md" file from before the
		// naming change, OR carries the ccBoard marker. The marker is what keeps
		// existing boards recognizable when the global file name is renamed, so
		// the global setting never "unregisters" a board that has its own name.
		const configured = this.getDatabaseFileName();
		if (file.name === `${configured}.md` || file.name.endsWith(BOARD_FILE_SUFFIX)) return true;
		const cache = this.app.metadataCache?.getFileCache(file);
		return cache?.frontmatter?.['ccBoard'] === true;
	}

	getBoardFileInFolder(folderPath: string): TFile | null {
		const folder = this.app.vault.getAbstractFileByPath(folderPath) as TFolder | null;
		if (!folder || !folder.children) return null;
		const board = folder.children.find(
			(child: any) => child.extension === 'md' && this.isBoardFile(child)
		) as TFile | undefined;
		return board ?? null;
	}

	async createBoard(folderPath: string): Promise<TFile> {
		const existing = this.getBoardFileInFolder(folderPath);
		if (existing) return existing;

		// Read the live setting so renaming in Settings takes effect on new boards.
		// The board file is named exactly after the configured database file name
		// (no "-board" suffix appended) — the user's name is used verbatim. If a
		// non-board file already uses that name, pick a numbered variant.
		const base = this.getDatabaseFileName();
		let boardName = `${base}.md`;
		let filePath = `${folderPath.replace(/\/$/, '')}/${boardName}`;
		let n = 2;
		while (this.app.vault.getAbstractFileByPath(filePath)) {
			boardName = `${base} ${n}.md`;
			filePath = `${folderPath.replace(/\/$/, '')}/${boardName}`;
			n++;
		}
		// Snapshot the current global General settings into the board so it is
		// self-contained: later global changes never override this board.
		const config: BoardConfig = {
			...DEFAULT_BOARD_CONFIG,
			schema: this.settings?.defaultBoardConfig?.schema ?? [],
			pageSize: this.settings?.pageSize,
			colorGroupPanels: this.settings?.colorGroupPanels,
			cardFontSize: this.settings?.cardFontSize,
			compactMode: this.settings?.compactMode,
			createdAtFieldName: this.settings?.createdAtFieldName,
			updatedAtFieldName: this.settings?.updatedAtFieldName,
			colorRules: (this.settings?.colorRules ?? []).map(r => ({ ...r })),
		};
		const content = serializeBoardConfig(config);
		return this.app.vault.create(filePath, content) as Promise<TFile>;
	}

	/** Rename the board's database file (Customize → General). The file name IS
	 *  the board's database file name, so no separate config value is stored.
	 *  Returns the renamed TFile so callers can keep working on the new path
	 *  (the old TFile reference may be stale after vault.rename). */
	async renameBoardFile(file: TFile, newName: string): Promise<TFile | null> {
		const name = newName.trim().replace(/\.md$/i, '').replace(/[\\/:*?"<>|]/g, '-');
		if (!name || name === file.basename) return null;
		try {
			const folder = file.parent?.path ?? '';
			const newPath = `${folder}/${name}.md`;
			await this.app.vault.rename(file, newPath);
			return this.app.vault.getFileByPath(newPath) ?? null;
		} catch {
			return null;
		}
	}

	getAllBoards(): TFile[] {
		const boards: TFile[] = [];
		const visit = (folder: TFolder) => {
			for (const child of folder.children) {
				// Duck-typing: check for TFile-like properties (extension, path) instead of instanceof
				// This works with both real Obsidian objects and test mocks.
				if (child && typeof child === 'object' && 'extension' in child && child.extension === 'md' && 'path' in child) {
					if (this.isBoardFile(child as TFile)) boards.push(child as TFile);
				} else if (child && typeof child === 'object' && 'children' in child && Array.isArray((child as TFolder).children)) {
					visit(child as TFolder);
				}
			}
		};
		const root = this.app.vault.getRoot();
		visit(root);
		return boards;
	}

	async readConfig(file: TFile): Promise<BoardConfig> {
		return deserializeBoardConfig(this.app.vault, file);
	}

	/** Load tasks from the folder containing the given board file */
	async getTasksForBoard(file: TFile): Promise<ReturnType<TaskFileManager['getTasksInFolder']>> {
		const folderPath = file.parent?.path ?? '';
		const config = await this.readConfig(file);
		const schema = config.schema.length > 0
			? config.schema
			: (this.settings?.defaultBoardConfig?.schema ?? []);
		const typeMap: Record<string, string> = {};
		for (const prop of schema) typeMap[prop.id] = prop.type;
		const names = await this.getEffectiveFieldNames(file, config);
		const result = await this.taskFileManager.getTasksInFolder(folderPath, true, typeMap, names);
		// Board files are ColorCoder system files, not tasks — drop every one of
		// them (not just the current board) so their config frontmatter
		// (pageSize, cardFontSize, colorRules, …) never leaks into the board or
		// the property list, even when several boards share a folder.
		if (result.success && result.data) {
			result.data = result.data.filter(t => {
				if (t._file === file.path) return false;
				const f = this.app.vault.getFileByPath?.(t._file) ?? this.app.vault.getAbstractFileByPath?.(t._file);
				// Duck-typing: check for TFile-like properties instead of instanceof
				return f && typeof f === 'object' && 'extension' in f && f.extension === 'md' && 'path' in f
					? !this.isBoardFile(f as TFile)
					: true;
			});
			// Auto-adopt any newly detected task properties into the board schema
			// so they get typed, appear in Quick Add, and persist.
			await this.autoAdoptProperties(file, result.data);
		}
		return result;
	}

	/**
	 * Auto-adopt newly detected task properties into the board's schema so they
	 * get typed, appear in Quick Add, and persist. Mirrors the General-level
	 * auto-adoption (Settings → Properties) but scoped to this board's tasks.
	 * Properties the user explicitly removed (excluded) are never re-added.
	 */
	async autoAdoptProperties(file: TFile, tasks: TaskFileSchema[]): Promise<void> {
		const config = await this.readConfig(file);
		const existing = new Set(config.schema.map(p => p.id));
		const excluded = new Set(config.schema.filter(p => p.excluded).map(p => p.id));
		const detected = this.getAvailableProperties(tasks);
		const fresh = detected.filter(id => !existing.has(id) && !excluded.has(id));
		if (fresh.length === 0) return;
		for (const id of fresh) {
			config.schema.push({ id, name: id, type: 'text', visible: true });
		}
		await this.app.vault.modify(file, serializeBoardConfig(config));
	}

	/** Effective timestamp field names for a board. Boards are self-contained:
	 *  their own config wins; otherwise the canonical defaults are used. The
	 *  plugin settings only seed NEW boards (see createBoard). */
	async getEffectiveFieldNames(file?: TFile | null, config?: BoardConfig): Promise<FieldNames> {
		let board = config;
		if (!board && file) board = await this.readConfig(file);
		return {
			createdAt: board?.createdAtFieldName ?? 'Created At',
			updatedAt: board?.updatedAtFieldName ?? 'Updated At',
		};
	}

	/** Update an arbitrary frontmatter field (used when dragging onto a group-by column). */
	async updateTaskField(boardFile: TFile, taskPath: string, fieldId: string, value: unknown): Promise<boolean> {
		const names = await this.getEffectiveFieldNames(boardFile);
		const result = await this.taskFileManager.updateTask(taskPath, { [fieldId]: value }, names);
		if (result.success) {
			// Auto-adopt new values into select/multiselect property options.
			await this.autoAdoptSelectValue(boardFile, fieldId, value);
		}
		return result.success;
	}

	/** If the field is a select/multiselect and the value isn't in its options, add it. */
	private async autoAdoptSelectValue(boardFile: TFile, fieldId: string, value: unknown): Promise<void> {
		if (value === undefined || value === null || value === '') return;
		const config = await this.readConfig(boardFile);
		const prop = config.schema?.find(p => p.id === fieldId);
		if (!prop || (prop.type !== 'select' && prop.type !== 'multiselect')) return;
		const options = prop.options ?? [];
		const values = Array.isArray(value) ? value : [value];
		let changed = false;
		for (const v of values) {
			const strValue = String(v);
			if (options.some(o => o.value === strValue)) continue;
			options.push({ value: strValue });
			changed = true;
		}
		if (changed) {
			await this.app.vault.modify(boardFile, serializeBoardConfig(config));
		}
	}

	/** Remove frontmatter properties used in fewer than `minUses` task files. */
	async cleanupRareProperties(minUses: number = 10): Promise<ReturnType<TaskFileManager['cleanupRareProperties']>> {
		return this.taskFileManager.cleanupRareProperties(minUses);
	}

	/** Create a task file in the given folder (used by the Quick Add modal) */
	async createTask(
		folderPath: string,
		initialData: Partial<TaskFileFrontmatter>,
		opts?: { fileName?: string },
		boardFile?: TFile | null
	): Promise<ReturnType<TaskFileManager['createTask']>> {
		const names = await this.getEffectiveFieldNames(boardFile ?? null);
		return this.taskFileManager.createTask(folderPath, initialData, opts, names);
	}

	/**
	 * Rename an auto-maintained timestamp field. For a specific board this
	 * rewrites the frontmatter key in every task file under the board folder
	 * and updates the board config. Without a board it only updates the plugin
	 * default (new tasks use it; existing files are not rewritten).
	 */
	async renameTimestampField(
		boardFile: TFile | null,
		kind: 'createdAt' | 'updatedAt',
		oldName: string,
		newName: string
	): Promise<boolean> {
		const key = newName.trim();
		if (!key || key === oldName) return false;

		if (!boardFile) {
			// Global default: update the setting + the default schema's Last edit.
			if (kind === 'updatedAt') this.settings.updatedAtFieldName = key;
			else this.settings.createdAtFieldName = key;
			const schema = this.settings?.defaultBoardConfig?.schema ?? [];
			if (kind === 'updatedAt') {
				const lastEdit = schema.find((p: ColumnSchema) => p.type === 'lastEdit');
				if (lastEdit) {
					lastEdit.id = key;
					lastEdit.fieldName = key;
				}
			}
			return true;
		}

		try {
			// Board-specific: rewrite the key in every task file in the folder.
			const folder = boardFile.parent?.path ?? '';
			const files = this.collectMarkdownFiles(this.app.vault.getAbstractFileByPath(folder) as TFolder);
			for (const file of files) {
				if (file.path === boardFile.path) continue;
				const content = await this.app.vault.read(file);
				const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
				if (!fmMatch) continue;
				const yaml = fmMatch[1];
				const re = new RegExp(`^(${escapeRegExp(oldName)}):\\s*(.*)$`, 'm');
				if (!re.test(yaml)) continue;
				const newYaml = yaml.replace(re, `${key}: $2`);
				const newContent = content.replace(fmMatch[1], newYaml);
				await this.app.vault.modify(file, newContent);
			}

			// Update the board config (and the schema's Last edit field).
			const config = await this.readConfig(boardFile);
			if (kind === 'updatedAt') {
				config.updatedAtFieldName = key;
				const lastEdit = config.schema.find((p: ColumnSchema) => p.type === 'lastEdit');
				if (lastEdit) {
					lastEdit.id = key;
					lastEdit.fieldName = key;
				}
			} else {
				config.createdAtFieldName = key;
			}
			await this.app.vault.modify(boardFile, serializeBoardConfig(config));
			return true;
		} catch {
			return false;
		}
	}

	/** Update arbitrary board-config fields and persist the whole board file. */
	async updateBoardConfig(file: TFile, updater: (config: BoardConfig) => BoardConfig): Promise<boolean> {
		try {
			const config = await this.readConfig(file);
			const content = serializeBoardConfig(updater(config));
			await this.app.vault.modify(file, content);
			return true;
		} catch {
			return false;
		}
	}

	private collectMarkdownFiles(folder: TFolder | null): TFile[] {
		if (!folder) return [];
		const files: TFile[] = [];
		for (const child of folder.children) {
			if ((child as TFile).extension === 'md') files.push(child as TFile);
			else if ((child as TFolder).children) files.push(...this.collectMarkdownFiles(child as TFolder));
		}
		return files;
	}

	/** Collect every property name present across the given tasks (for schema auto-inference). */
	getAvailableProperties(tasks: TaskFileSchema[]): string[] {
		const keys = new Set<string>();
		for (const task of tasks) {
			for (const key of Object.keys(task)) {
				if (key.startsWith('_')) continue;
				if (HALLUCINATED_KEYS.has(key)) continue;
				keys.add(key);
			}
		}
		// Drop keys that carry no value on any task. Anything with data anywhere
		// is kept.
		return [...keys].filter(key => tasks.some(t => !isEmptyValue(t[key]))).sort();
	}

	/**
	 * Scan every markdown file in the vault (excluding .obsidian) and report
	 * each property's usage count, distinct non-empty values, and inferred
	 * type. Powers the Settings properties table so all *existing* properties
	 * can be typed, not just the ones already in the schema.
	 */
	async getVaultPropertyStats(fieldNames?: FieldNames): Promise<
		{ key: string; count: number; values: string[]; type: string }[]
	> {
		const timestampFields = new Set([
			fieldNames?.createdAt ?? this.settings?.createdAtFieldName ?? 'Created At',
			fieldNames?.updatedAt ?? this.settings?.updatedAtFieldName ?? 'Updated At',
		].filter(Boolean));
		const stats = new Map<
			string,
			{ key: string; count: number; values: Set<string>; type: string }
		>();
		const configDir = this.app.vault.configDir;
		const files = (this.app.vault.getMarkdownFiles?.() ?? []).filter(
			(f: TFile) => !f.path.includes(configDir) && !this.isBoardFile(f)
		);

		const noteValue = (value: unknown): string => {
			if (Array.isArray(value)) return value.filter(v => v !== '' && v !== null && v !== undefined).map(String).join(', ');
			if (value === null || value === undefined || value === '') return '';
			return String(value);
		};

		const inferType = (value: unknown): string => inferPropertyType(value);

		const processFrontmatter = (fm: Record<string, unknown>) => {
			for (const [key, value] of Object.entries(fm)) {
				if (key.startsWith('_')) continue;
				if (HALLUCINATED_KEYS.has(key)) continue;
				if (timestampFields.has(key)) continue;
				const str = noteValue(value);
				const entry = stats.get(key) ?? { key, count: 0, values: new Set<string>(), type: 'text' };
				entry.count += 1;
				if (str) entry.values.add(str);
				// Upgrade to the most specific observed type (checkbox/number
				// beat text, datetime beats date), same priority as Obsidian.
				const t = inferType(value);
				if (t === 'datetime' || (t === 'date' && entry.type !== 'datetime')) entry.type = t;
				else if ((t === 'checkbox' || t === 'number' || t === 'multiselect') && entry.type === 'text') entry.type = t;
				stats.set(key, entry);
			}
		};

		// Fast path: Obsidian's metadata cache already parsed every file's
		// frontmatter, so we avoid reading each file from disk (the slow part).
		const cache = this.app.metadataCache;
		if (cache?.getFileCache) {
			for (const file of files) {
				try {
					const fm = cache.getFileCache(file)?.frontmatter;
					if (fm) processFrontmatter(fm);
				} catch {
					// skip unreadable files
				}
			}
		} else {
			// Fallback (tests / no cache): read files in parallel.
			await Promise.all(files.map(async (file: TFile) => {
				try {
					const content = await this.app.vault.read(file);
					const match = content.match(/^---\n([\s\S]*?)\n---/);
					if (!match) return;
					const fm: Record<string, unknown> = {};
					for (const line of match[1].split('\n')) {
						const colonIndex = line.indexOf(':');
						if (colonIndex <= 0) continue;
						const key = line.slice(0, colonIndex).trim();
						if (key.startsWith('_')) continue;
						if (HALLUCINATED_KEYS.has(key)) continue;
						fm[key] = parseScalar(line.slice(colonIndex + 1).trim());
					}
					processFrontmatter(fm);
				} catch {
					// skip unreadable files
				}
			}));
		}

		return [...stats.values()]
			.map(s => ({ key: s.key, count: s.count, values: [...s.values], type: s.type }))
			.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
	}

	/** Update the schema (property definitions) of a board file and persist it. */
	async updateBoardSchema(file: TFile, schema: ColumnSchema[]): Promise<boolean> {
		try {
			const config = await this.readConfig(file);
			const content = serializeBoardConfig({ ...config, schema });
			await this.app.vault.modify(file, content);
			return true;
		} catch {
			return false;
		}
	}

	/** Delete a property from the board schema and strip its values from every
	 *  task file in the board folder. */
	async deleteProperty(boardFile: TFile, propertyId: string): Promise<boolean> {
		try {
			const config = await this.readConfig(boardFile);
			config.schema = config.schema.filter(p => p.id !== propertyId);
			await this.app.vault.modify(boardFile, serializeBoardConfig(config));
			const folder = boardFile.parent?.path ?? '';
			await this.taskFileManager.deletePropertyValues(folder, propertyId);
			return true;
		} catch {
			return false;
		}
	}

	/** Strip a property's values from every task file in the vault (General settings). */
	async deletePropertyVaultWide(propertyId: string): Promise<boolean> {
		try {
			await this.taskFileManager.deletePropertyValues('', propertyId);
			return true;
		} catch {
			return false;
		}
	}

	/** One-time migration: boards created before per-board color rules existed
	 *  have no snapshot. Copy the current global rules into them so later global
	 *  changes (e.g. deleting a rule) never affect existing boards. */
	async migrateBoardColorRules(): Promise<number> {
		const boards = this.getAllBoards();
		let migrated = 0;
		for (const b of boards) {
			const config = await this.readConfig(b);
			if (config.colorRules) continue;
			config.colorRules = (this.settings?.colorRules ?? []).map(r => ({ ...r }));
			await this.app.vault.modify(b, serializeBoardConfig(config));
			migrated++;
		}
		return migrated;
	}

	/** Override every board with the current plugin defaults (schema, view,
	 *  per-board settings and color rules). Explicit user action — the defaults
	 *  never touch existing boards otherwise. */
	async applyDefaultsToAllBoards(): Promise<number> {
		const defaults = this.settings?.defaultBoardConfig;
		const boards = this.getAllBoards();
		for (const b of boards) {
			const config = await this.readConfig(b);
			const newConfig: BoardConfig = {
				...config,
				schema: (defaults?.schema ?? []).map(p => ({ ...p })),
				views: defaults?.views && defaults.views.length > 0 ? defaults.views.map(v => ({ ...v })) : config.views,
				pageSize: this.settings?.pageSize,
				colorGroupPanels: this.settings?.colorGroupPanels,
				cardFontSize: this.settings?.cardFontSize,
				compactMode: this.settings?.compactMode,
				createdAtFieldName: this.settings?.createdAtFieldName,
				updatedAtFieldName: this.settings?.updatedAtFieldName,
				colorRules: (this.settings?.colorRules ?? []).map(r => ({ ...r })),
			};
			await this.app.vault.modify(b, serializeBoardConfig(newConfig));
		}
		return boards.length;
	}

	/** Update a field on the first view of a board file and persist the change. */
	async updateViewConfig(file: TFile, updater: (view: ViewConfig) => ViewConfig): Promise<boolean> {
		try {
			const config = await this.readConfig(file);
			const views = config.views && config.views.length > 0 ? config.views : [DEFAULT_VIEW];
			const updated = updater(views[0]);
			views[0] = updated;
			const content = serializeBoardConfig({ ...config, views });
			await this.app.vault.modify(file, content);
			return true;
		} catch {
			return false;
		}
	}
}

function emptySettings(): PluginSettings {
	return {
		databaseFileName: 'ColorCoder-board',
		defaultBoardConfig: DEFAULT_BOARD_CONFIG,
		colorRules: [],
	};
}

/** True when a property value is effectively empty (blank / null / empty array or object). */
function isEmptyValue(value: unknown): boolean {
	if (value === undefined || value === null || value === '') return true;
	if (Array.isArray(value)) return value.length === 0;
	if (typeof value === 'object') return Object.keys(value).length === 0;
	return false;
}

/** Escape a string for use inside a RegExp literal. */
function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Board config is stored as frontmatter on the board file. `ccBoard` marks the
// file as a board so it stays recognizable even when its name no longer matches
// the global database file name.
export function serializeBoardConfig(config: BoardConfig): string {
	const lines = ['---'];
	lines.push('ccBoard: true');
	lines.push(`schema: ${JSON.stringify(config.schema)}`);
	lines.push(`views: ${JSON.stringify(config.views)}`);
	if (config.pageSize !== undefined) lines.push(`pageSize: ${config.pageSize}`);
	if (config.colorGroupPanels !== undefined) lines.push(`colorGroupPanels: ${config.colorGroupPanels}`);
	if (config.cardFontSize !== undefined) lines.push(`cardFontSize: ${config.cardFontSize}`);
	if (config.compactMode !== undefined) lines.push(`compactMode: ${config.compactMode}`);
	if (config.createdAtFieldName) lines.push(`createdAtFieldName: ${JSON.stringify(config.createdAtFieldName)}`);
	if (config.updatedAtFieldName) lines.push(`updatedAtFieldName: ${JSON.stringify(config.updatedAtFieldName)}`);
	if (config.colorRules) lines.push(`colorRules: ${JSON.stringify(config.colorRules)}`);
	lines.push('---');
	return lines.join('\n');
}

export async function deserializeBoardConfig(vault: { cachedRead: (file: TFile) => Promise<string> }, file: TFile): Promise<BoardConfig> {
	return Promise.resolve(vault.cachedRead(file)).then((content: string) => {
		const match = content.match(/^---\n([\s\S]*?)\n---/);
		if (!match) return DEFAULT_BOARD_CONFIG;
		try {
			const schema = extractJsonValue(match[1], 'schema');
			const views = extractJsonValue(match[1], 'views');
			const pageSize = extractJsonValue(match[1], 'pageSize');
			const colorGroupPanels = extractJsonValue(match[1], 'colorGroupPanels');
			const cardFontSize = extractJsonValue(match[1], 'cardFontSize');
			const compactMode = extractJsonValue(match[1], 'compactMode');
			const createdAtFieldName = extractJsonValue(match[1], 'createdAtFieldName');
			const updatedAtFieldName = extractJsonValue(match[1], 'updatedAtFieldName');
			const colorRules = extractJsonValue(match[1], 'colorRules');
			return {
				schema: Array.isArray(schema) ? schema : [],
				views: Array.isArray(views) ? views : [],
				pageSize: typeof pageSize === 'number' ? pageSize : undefined,
				colorGroupPanels: typeof colorGroupPanels === 'boolean' ? colorGroupPanels : undefined,
				cardFontSize: typeof cardFontSize === 'number' ? cardFontSize : undefined,
				compactMode: typeof compactMode === 'boolean' ? compactMode : undefined,
				createdAtFieldName: typeof createdAtFieldName === 'string' ? createdAtFieldName : undefined,
				updatedAtFieldName: typeof updatedAtFieldName === 'string' ? updatedAtFieldName : undefined,
				colorRules: Array.isArray(colorRules) ? colorRules : undefined,
			};
		} catch {
			return DEFAULT_BOARD_CONFIG;
		}
	});
}

function extractJsonValue(frontmatter: string, key: string): unknown {
	const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
	if (!match) return null;
	const raw = match[1].trim();
	if (raw === '[]') return [];
	if (raw === 'null' || raw === '~') return null;
	// JSON.parse handles quoted strings (e.g. "created At"), numbers, booleans.
	// Bare values (unquoted strings) fall back to the raw text.
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}
