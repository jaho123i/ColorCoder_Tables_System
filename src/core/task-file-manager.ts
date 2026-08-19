import { App, TFile, TFolder, Vault } from 'obsidian';
import { TaskFileSchema, TaskFileFrontmatter } from '../types/task-schema';
import { InlineFieldMeta } from '../types/index';
import { PluginSettings } from '../types/plugin-settings';

interface ObsidianFile {
	path: string;
	name: string;
	extension: string;
	parent: ObsidianFolder | null;
}

interface ObsidianFolder {
	path: string;
	name: string;
	parent: ObsidianFolder | null;
	children: (ObsidianFile | ObsidianFolder)[];
}

function isFile(file: unknown): file is ObsidianFile {
	return (
		typeof file === 'object' &&
		file !== null &&
		'extension' in file &&
		typeof (file as Record<string, unknown>).extension === 'string'
	);
}

function isFolder(folder: unknown): folder is ObsidianFolder {
	return (
		typeof folder === 'object' &&
		folder !== null &&
		'children' in folder &&
		Array.isArray((folder as Record<string, unknown>).children)
	);
}

function toTFile(file: ObsidianFile): TFile {
	return file as unknown as TFile;
}

function toTFolder(folder: ObsidianFolder): TFolder {
	return folder as unknown as TFolder;
}

export interface Result<T, E = Error> {
	success: boolean;
	data?: T;
	error?: E;
	/** True when the operation failed because a file with the target name already exists. */
	conflict?: boolean;
}

export interface TaskFileManagerDeps {
	app: App;
	settings: PluginSettings;
}

/** Effective frontmatter keys for the auto-maintained timestamps. A board can
 *  override the global names; when omitted the plugin settings (or the
 *  canonical defaults) are used. */
export interface FieldNames {
	createdAt: string;
	updatedAt: string;
}

/** Resolve the effective timestamp keys from settings (used when no board
 *  context is available, e.g. global cleanup). */
export function defaultFieldNames(settings?: PluginSettings): FieldNames {
	return {
		createdAt: settings?.createdAtFieldName ?? 'Created At',
		updatedAt: settings?.updatedAtFieldName ?? 'Updated At',
	};
}

/** Plugin-managed keys that are never removed by property cleanup. */
const SYSTEM_KEYS = new Set([
	'id', 'title', 'createdAt', 'updatedAt',
]);

function parseFrontmatter(content: string, typeMap?: Record<string, string>): Result<TaskFileFrontmatter> {
	try {
		const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
		if (!frontmatterMatch) {
			return { success: false, error: new Error('No frontmatter found') };
		}
		const yamlContent = frontmatterMatch[1];
		const frontmatter: Record<string, unknown> = {};
		for (const line of yamlContent.split('\n')) {
			const colonIndex = line.indexOf(':');
			if (colonIndex > 0) {
				const key = line.slice(0, colonIndex).trim();
				const value = line.slice(colonIndex + 1).trim();
				frontmatter[key] = parseYamlValue(value, typeMap?.[key]);
			}
		}
		return { success: true, data: frontmatter as TaskFileFrontmatter };
	} catch (error) {
		return { success: false, error: error as Error };
	}
}

function isSuccess<T>(result: Result<T>): result is Result<T> & { data: T } {
	return result.success;
}

/** Parse a single inline-field value (number/boolean/null stay typed, else string). */
function parseInlineValue(raw: string): unknown {
	const t = raw.trim();
	if (t === 'true') return true;
	if (t === 'false') return false;
	if (t === 'null' || t === '~') return null;
	if (/^[-+]?\d+(\.\d+)?$/.test(t)) return Number(t);
	return t;
}

/**
 * Parse Dataview-style inline fields from a note body:
 *   `Key:: value`            (standalone, at the start of a line)
 *   `[Key:: value]`          (bracketed)
 *   `(Key:: value)`          (parenthesized)
 * Returns the parsed values plus per-field metadata (format, raw text, line).
 * Frontmatter always wins over inline fields when both define the same key.
 */
function parseInlineFields(body: string): { values: Record<string, unknown>; meta: Record<string, InlineFieldMeta> } {
	const values: Record<string, unknown> = {};
	const meta: Record<string, InlineFieldMeta> = {};
	const lines = body.split('\n');
	lines.forEach((line, idx) => {
		const standalone = line.match(/^([^:\n]+)::\s*(.+)$/);
		if (standalone) {
			const key = standalone[1].trim();
			const rawValue = standalone[2].trim();
			if (key && rawValue) {
				values[key] = parseInlineValue(rawValue);
				meta[key] = { format: 'standalone', rawKey: key, rawValue, lineNumber: idx, fullMatch: line };
			}
		}
		const re = /\[([^\]\n]+)::\s*([^\]]+)\]|\(([^()\n]+)::\s*([^)]+)\)/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(line)) !== null) {
			const key = (m[1] ?? m[3]).trim();
			const rawValue = (m[2] ?? m[4]).trim();
			const format: InlineFieldMeta['format'] = m[1] !== undefined ? 'bracketed' : 'parenthesized';
			if (key && rawValue) {
				values[key] = parseInlineValue(rawValue);
				meta[key] = { format, rawKey: key, rawValue, lineNumber: idx, fullMatch: m[0] };
			}
		}
	});
	return { values, meta };
}

/**
 * Parse a single YAML scalar. When a property type is known and is not
 * `number`, numeric-looking strings are preserved as strings — otherwise a
 * date like `2026-08-03` or a select option like `2026` would be coerced to a
 * number and break grouping/rendering.
 */
function parseYamlValue(value: string, type?: string): unknown {
	const trimmed = value.trim();
	if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
		return trimmed.slice(1, -1);
	}
	if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
		return trimmed.slice(1, -1);
	}
	if (trimmed === 'true') return true;
	if (trimmed === 'false') return false;
	if (trimmed === 'null' || trimmed === '~') return null;
	// Only coerce to a number when the round-trip is lossless, so values like
	// "06.2026" stay strings instead of becoming 6.2026.
	if (type !== 'number') {
		if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
			return trimmed.slice(1, -1).split(',').map(v => parseYamlValue(v.trim(), type));
		}
		return trimmed;
	}
	const num = Number(trimmed);
	if (!isNaN(num) && trimmed !== '' && String(num) === trimmed) return num;
	if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
		return trimmed.slice(1, -1).split(',').map(v => parseYamlValue(v.trim(), type));
	}
	return trimmed;
}

function stringifyFrontmatter(frontmatter: TaskFileFrontmatter): string {
	const lines = ['---'];
	for (const [key, value] of Object.entries(frontmatter)) {
		if (value === undefined) continue;
		lines.push(`${key}: ${formatYamlValue(value)}`);
	}
	lines.push('---');
	return lines.join('\n');
}

/**
 * True when a YAML parser (js-yaml core schema) would read the string as a
 * non-string scalar (number, boolean, null, empty). Such strings must be
 * quoted on write, otherwise "07.2026" round-trips as the number 7.2026 and
 * the value stops matching its column.
 */
function yamlNeedsQuotes(value: string): boolean {
	if (value === '') return true;
	if (/^(true|false|null|~|yes|no|on|off)$/i.test(value)) return true;
	if (/^[-+]?0[xob][0-9a-fA-F_]+$/.test(value)) return true; // hex/octal/binary
	// ints, floats (incl. leading-zero like 07.2026), and exponents
	if (/^[-+]?[0-9][0-9_]*(\.[0-9_]*)?([eE][-+]?[0-9]+)?$/.test(value)) return true;
	// YAML tag indicator — `!` / `!!` / `!!!` would be read as a tag, not text
	if (/^!/.test(value)) return true;
	return false;
}

function formatYamlValue(value: unknown): string {
	if (value === null) return 'null';
	if (typeof value === 'string') {
		// Quote strings that contain YAML-special characters or would be
		// misinterpreted as non-string scalars.
		const needsQuotes =
			value.includes(':') ||
			value.includes('#') ||
			value.includes('[') ||
			value.includes(']') ||
			value.includes('{') ||
			value.includes('}') ||
			value.includes('&') ||
			value.includes('*') ||
			value.includes('!') ||
			value.includes('|') ||
			value.includes('>') ||
			value.includes('\'') ||
			value.includes('%') ||
			value.includes('@') ||
			value.includes(',') ||
			value.includes('\n') ||
			value.includes('\r') ||
			value.includes('"') ||
			value.includes("'") ||
			value.startsWith(' ') ||
			value.endsWith(' ') ||
			yamlNeedsQuotes(value);
		if (needsQuotes) {
			return `"${value.replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;
		}
		return value;
	}
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	if (typeof value === 'number') return String(value);
	if (Array.isArray(value)) {
		return `[${value.map(formatYamlValue).join(', ')}]`;
	}
	if (typeof value === 'object') {
		return JSON.stringify(value);
	}
	return String(value);
}

function createTaskFileContent(frontmatter: TaskFileFrontmatter, body: string = ''): string {
	return `${stringifyFrontmatter(frontmatter)}\n${body}`;
}

/**
 * Readable local-time timestamp, e.g. `2026-08-03 15:35`. Uses the system
 * timezone (no UTC `Z` suffix) so the "last edit" time matches what the user
 * sees on their clock.
 */
export function formatUpdatedAt(d: Date = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function mergeFrontmatter(
	existing: TaskFileFrontmatter,
	updates: Partial<TaskFileFrontmatter>
): TaskFileFrontmatter {
	return { ...existing, ...updates };
}

/**
 * Tolerate a missing/empty title by falling back to the file basename. All
 * other frontmatter keys are preserved as-is — the plugin is schema-driven and
 * never renames user properties onto canonical keys.
 */
function normalizeFrontmatterKeys(frontmatter: Record<string, unknown>, fileBasename: string): Record<string, unknown> {
	const out: Record<string, unknown> = { ...frontmatter };
	if (out['title'] === undefined || out['title'] === '') {
		out['title'] = fileBasename;
	}
	return out;
}

export class TaskFileManager {
	private readonly app: App;
	private readonly settings: PluginSettings;
	private readonly vault: Vault;

	constructor(deps: TaskFileManagerDeps) {
		this.app = deps.app;
		this.settings = deps.settings;
		this.vault = deps.app.vault;
	}

	async createTask(folderPath: string, initialData: Partial<TaskFileFrontmatter>, opts?: { fileName?: string }, fieldNames?: FieldNames): Promise<Result<ObsidianFile>> {
		try {
			const folder = this.app.vault.getAbstractFileByPath(folderPath);
			if (!folder || !isFolder(folder)) {
				return { success: false, error: new Error(`Folder not found: ${folderPath}`) };
			}

			const now = formatUpdatedAt();
			const names = fieldNames ?? defaultFieldNames(this.settings);

			// Only write fields that carry a meaningful value. Empty values are
			// omitted so a fresh task file stays clean.
			const frontmatter: Record<string, unknown> = {
				title: initialData.title ?? 'Untitled Task',
				[names.updatedAt]: now,
			};
			if (this.settings?.autoUpdateCreatedAt !== false) frontmatter[names.createdAt] = now;
			// Preserve any extra (custom) properties the caller supplied.
			for (const [key, v] of Object.entries(initialData)) {
				if (key in frontmatter) continue;
				if (v === undefined || v === null) continue;
				const empty = Array.isArray(v) ? v.length === 0 : v === '';
				if (empty) continue;
				frontmatter[key] = v;
			}

			// Name the file after the task title (sanitized for the filesystem).
			const baseName = sanitizeFileName(String(frontmatter.title));
			const fileName = opts?.fileName ?? `${baseName}.md`;
			const filePath = `${folderPath}/${fileName}`;
			if (this.app.vault.getAbstractFileByPath(filePath)) {
				return { success: false, conflict: true, error: new Error(`A file named "${fileName}" already exists`) };
			}
			const content = createTaskFileContent(frontmatter as TaskFileFrontmatter);

			const file = await this.vault.create(filePath, content);
			return { success: true, data: file as unknown as ObsidianFile };
		} catch (error) {
			return { success: false, error: error as Error };
		}
	}

	async readTask(filePath: string, typeMap?: Record<string, string>, fieldNames?: FieldNames): Promise<Result<TaskFileSchema>> {
		try {
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (!file || !isFile(file)) {
				return { success: false, error: new Error(`File not found: ${filePath}`) };
			}

			const content = await this.vault.read(toTFile(file));
			const parseResult = parseFrontmatter(content, typeMap);

			if (!isSuccess(parseResult)) {
				return { success: false, error: parseResult.error };
			}

			const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)/);
			const body = bodyMatch ? bodyMatch[1] : '';
			const inline = parseInlineFields(body);

			const frontmatter = normalizeFrontmatterKeys(parseResult.data, file.name.replace(/\.md$/i, '')) as TaskFileFrontmatter;
			const names = fieldNames ?? defaultFieldNames(this.settings);
			const updatedAtKey = names.updatedAt;
			const canonicalKeys = new Set([
				'_file', '_title', '_body', 'id', 'title', 'createdAt', 'updatedAt',
			]);
			const extraKeys: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(frontmatter)) {
				if (!canonicalKeys.has(key)) extraKeys[key] = value;
			}
			const taskFile: TaskFileSchema = {
				_file: filePath,
				_title: frontmatter.title ?? 'Untitled',
				id: frontmatter.id ?? '',
				title: frontmatter.title ?? 'Untitled',
				createdAt: String(frontmatter[names.createdAt] ?? frontmatter.createdAt ?? new Date().toISOString()),
				updatedAt: String((frontmatter as Record<string, unknown>)[updatedAtKey] ?? frontmatter.updatedAt ?? new Date().toISOString()),
				_body: body,
				_inlineFields: inline.meta,
				// Preserve every other property so any frontmatter key can be grouped/filtered
				...extraKeys,
			};
			// Inline fields are available as properties too, but frontmatter wins
			// when both define the same key.
			for (const [key, value] of Object.entries(inline.values)) {
				if (!(key in taskFile)) taskFile[key] = value;
			}

			return { success: true, data: taskFile };
		} catch (error) {
			return { success: false, error: error as Error };
		}
	}

	async updateTask(filePath: string, updates: Partial<TaskFileFrontmatter>, fieldNames?: FieldNames): Promise<Result<ObsidianFile>> {
		try {
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (!file || !isFile(file)) {
				return { success: false, error: new Error(`File not found: ${filePath}`) };
			}

			const content = await this.vault.read(toTFile(file));
			const parseResult = parseFrontmatter(content);

			if (!isSuccess(parseResult)) {
				return { success: false, error: parseResult.error };
			}

			const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)/);
			const body = bodyMatch ? bodyMatch[1] : '';

			const existingFrontmatter = parseResult.data;
			const names = fieldNames ?? defaultFieldNames(this.settings);
			const mergedFrontmatter = this.settings?.autoUpdateUpdatedAt === false
				? mergeFrontmatter(existingFrontmatter, updates)
				: mergeFrontmatter(existingFrontmatter, {
					...updates,
					[names.updatedAt]: formatUpdatedAt(),
				});

			const newContent = createTaskFileContent(mergedFrontmatter, body);
			await this.vault.modify(toTFile(file), newContent);

			return { success: true, data: file };
		} catch (error) {
			return { success: false, error: error as Error };
		}
	}

	async deleteTask(filePath: string): Promise<Result<void>> {
		try {
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (!file || !isFile(file)) {
				return { success: false, error: new Error(`File not found: ${filePath}`) };
			}

			await this.app.fileManager.trashFile(toTFile(file));
			return { success: true, data: undefined };
		} catch (error) {
			return { success: false, error: error as Error };
		}
	}

	/**
	 * Remove frontmatter properties that appear in fewer than `minUses` files.
	 * System keys (id, title, timestamps, …) are always kept.
	 * Returns a map of deleted key → number of files it was removed from.
	 */
	async cleanupRareProperties(minUses: number = 10): Promise<Result<Record<string, number>>> {
		try {
			const configDir = this.vault.configDir;
			const files = (this.vault.getMarkdownFiles?.() ?? []).filter(f => !f.path.includes(configDir));
			const names = defaultFieldNames(this.settings);
			const counts = new Map<string, number>();
			const parsed = new Map<string, { file: TFile; fm: TaskFileFrontmatter; body: string }>();

			for (const file of files) {
				const content = await this.vault.read(file);
				const parseResult = parseFrontmatter(content);
				if (!isSuccess(parseResult)) continue;
				const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)/);
				parsed.set(file.path, { file, fm: parseResult.data, body: bodyMatch ? bodyMatch[1] : '' });
				for (const key of Object.keys(parseResult.data)) {
					if (SYSTEM_KEYS.has(key)) continue;
					if (key === names.updatedAt || key === names.createdAt) continue;
					counts.set(key, (counts.get(key) ?? 0) + 1);
				}
			}

			const toDelete = new Set<string>();
			for (const [key, count] of counts) {
				if (count < minUses) toDelete.add(key);
			}
			if (toDelete.size === 0) return { success: true, data: {} };

			const deleted: Record<string, number> = {};
			for (const { file, fm, body } of parsed.values()) {
				let changed = false;
				for (const key of toDelete) {
					if (key in fm) {
						delete fm[key];
						deleted[key] = (deleted[key] ?? 0) + 1;
						changed = true;
					}
				}
				if (changed) {
					await this.vault.modify(file, createTaskFileContent(fm, body));
				}
			}
			return { success: true, data: deleted };
		} catch (error) {
			return { success: false, error: error as Error };
		}
	}

	/** Remove a property (frontmatter key) from every task file in a folder. */
	async deletePropertyValues(folderPath: string, propertyId: string): Promise<Result<number>> {
		try {
			const folder = this.app.vault.getAbstractFileByPath(folderPath);
			if (!folder || !isFolder(folder)) return { success: true, data: 0 };
			const configDir = this.vault.configDir;
			const files = this.collectMarkdownFiles(toTFolder(folder), true)
				.filter(f => !f.path.includes(configDir));
			let removed = 0;
			for (const file of files) {
				const content = await this.vault.read(file);
				const parseResult = parseFrontmatter(content);
				if (!isSuccess(parseResult)) continue;
				if (!(propertyId in parseResult.data)) continue;
				const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)/);
				const fm = parseResult.data;
				delete fm[propertyId];
				await this.vault.modify(file, createTaskFileContent(fm, bodyMatch ? bodyMatch[1] : ''));
				removed++;
			}
			return { success: true, data: removed };
		} catch (error) {
			return { success: false, error: error as Error };
		}
	}

	async getTasksInFolder(
		folderPath: string,
		includeSubfolders: boolean = true,
		typeMap?: Record<string, string>,
		fieldNames?: FieldNames
	): Promise<Result<TaskFileSchema[]>> {
		try {
			const folder = this.app.vault.getAbstractFileByPath(folderPath);
			if (!folder || !isFolder(folder)) {
				return { success: false, error: new Error(`Folder not found: ${folderPath}`) };
			}

			const files = this.collectMarkdownFiles(toTFolder(folder), includeSubfolders);
			const tasks: TaskFileSchema[] = [];

			for (const file of files) {
				const result = await this.readTask(file.path, typeMap, fieldNames);
				if (result.success && result.data) {
					tasks.push(result.data);
				}
			}

			return { success: true, data: tasks };
		} catch (error) {
			return { success: false, error: error as Error };
		}
	}

	private collectMarkdownFiles(folder: TFolder, includeSubfolders: boolean): TFile[] {
		const files: TFile[] = [];
		for (const child of folder.children) {
			if (isFile(child) && child.extension === 'md') {
				files.push(toTFile(child));
			} else if (includeSubfolders && isFolder(child)) {
				files.push(...this.collectMarkdownFiles(toTFolder(child), includeSubfolders));
			}
		}
		return files;
	}

	inferSchemaFromTasks(tasks: TaskFileSchema[]): Record<string, string> {
		const fieldTypes: Record<string, Set<string>> = {};

		for (const task of tasks) {
			for (const [key, value] of Object.entries(task)) {
				if (key.startsWith('_')) continue;
				const type = this.inferType(value);
				if (!fieldTypes[key]) fieldTypes[key] = new Set();
				fieldTypes[key].add(type);
			}
		}

		const schema: Record<string, string> = {};
		for (const [key, types] of Object.entries(fieldTypes)) {
			schema[key] = types.size === 1 ? types.values().next().value! : 'mixed';
		}
		return schema;
	}

	private inferType(value: unknown): string {
		if (value === null || value === undefined) return 'null';
		if (typeof value === 'boolean') return 'boolean';
		if (typeof value === 'number') return 'number';
		if (Array.isArray(value)) return 'array';
		if (typeof value === 'object') return 'object';
		const str = String(value);
		if (/^\d{4}-\d{2}-\d{2}/.test(str)) return 'date';
		if (/^\d+$/.test(str)) return 'number';
		if (str === 'true' || str === 'false') return 'boolean';
		return 'string';
	}

	private generateTaskId(): string {
		return `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
	}
}

/** Strip characters Obsidian/Windows forbid in filenames; fall back to a safe name. */
function sanitizeFileName(name: string): string {
	// Remove control characters, filesystem-forbidden chars, and leading/trailing dots/spaces.
	const cleaned = name
		// eslint-disable-next-line no-control-regex -- control chars must be stripped for valid filenames
		.replace(/[\x00-\x1F\x7F]/g, '') // control chars
		.replace(/[\\/:*?"<>|#^[\]]/g, '') // filesystem forbidden
		.replace(/^\.+/, '') // leading dots
		.replace(/\.+$/, '') // trailing dots
		.trim();
	return cleaned || 'Untitled';
}