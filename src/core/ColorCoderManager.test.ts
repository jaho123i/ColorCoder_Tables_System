import { describe, it, expect, vi } from 'vitest';
import { serializeBoardConfig, deserializeBoardConfig, ColorCoderManager } from './ColorCoderManager';
import { DEFAULT_BOARD_CONFIG, BoardConfig, ViewConfig } from '../types/index';
import { TaskFileSchema } from '../types/task-schema';

const mockVault = (content: string) => ({
	cachedRead: () => Promise.resolve(content),
});

describe('Board config serialization', () => {
	it('round-trips a config through frontmatter', async () => {
		const config: BoardConfig = {
			schema: [{ id: 'status', name: 'Status', type: 'select', visible: true }],
			views: [{ id: 'default', type: 'board', filters: [], sorts: [], hiddenColumns: [], columnWidths: {} }],
		};

		const content = serializeBoardConfig(config);
		const result = await deserializeBoardConfig(mockVault(content), {} as any);

		expect(result.schema).toHaveLength(1);
		expect(result.schema[0].id).toBe('status');
		expect(result.views).toHaveLength(1);
		expect(result.views[0].type).toBe('board');
	});

	it('returns defaults for a board file with no frontmatter', async () => {
		const result = await deserializeBoardConfig(mockVault('# just a note'), {} as any);
		expect(result).toEqual(DEFAULT_BOARD_CONFIG);
	});
});

describe('createBoard', () => {
	it('snapshots the current plugin General settings into the new board', async () => {
		const created: { path: string; content: string }[] = [];
		const vault = {
			getAbstractFileByPath: () => null,
			create: (path: string, content: string) => {
				created.push({ path, content });
				return Promise.resolve({ path });
			},
			metadataCache: { getFileCache: () => null },
		};
		const settings = {
			databaseFileName: 'MyBoard',
			defaultBoardConfig: { schema: [], views: [] },
			colorRules: [{ id: 'r1', name: 'R', kind: 'condition', columnId: 'Status', operator: 'is', value: 'x', backgroundColor: '#fff', textColor: '#000', priority: 0 }],
			pageSize: 30,
			colorGroupPanels: true,
			cardFontSize: 18,
			createdAtFieldName: 'created At',
			updatedAtFieldName: 'updatedAt',
		};
		const manager = new ColorCoderManager({ vault } as any, 'MyBoard', settings as any);

		await manager.createBoard('Folder');

		expect(created).toHaveLength(1);
		expect(created[0].path).toBe('Folder/MyBoard.md');
		const result = await deserializeBoardConfig(mockVault(created[0].content), {} as any);
		expect(result.pageSize).toBe(30);
		expect(result.colorGroupPanels).toBe(true);
		expect(result.cardFontSize).toBe(18);
		expect(result.createdAtFieldName).toBe('created At');
		expect(result.updatedAtFieldName).toBe('updatedAt');
		expect(result.colorRules).toHaveLength(1);
		expect(result.colorRules?.[0].columnId).toBe('Status');
	});

	it('uses the default board name when the global database file name is empty', async () => {
		const created: { path: string }[] = [];
		const vault = {
			getAbstractFileByPath: () => null,
			create: (path: string, _content: string) => {
				created.push({ path });
				return Promise.resolve({ path });
			},
			metadataCache: { getFileCache: () => null },
		};
		const settings = {
			databaseFileName: '',
			defaultBoardConfig: { schema: [], views: [] },
			colorRules: [],
			pageSize: 30,
		};
		const manager = new ColorCoderManager({ vault } as any, 'old-last-used-name', settings as any);

		await manager.createBoard('Folder');

		expect(created[0].path).toBe('Folder/ColorCoder-board.md');
	});

	it('returns an existing board in the folder instead of creating a duplicate', async () => {
		const existing = { path: 'Folder/ColorCoder-board.md', extension: 'md', name: 'ColorCoder-board.md' };
		const vault = {
			getAbstractFileByPath: (p: string) => (p === 'Folder' ? { children: [existing] } : null),
			getFileByPath: () => existing,
			metadataCache: { getFileCache: (f: any) => (f === existing ? { frontmatter: { ccBoard: true } } : null) },
			create: () => Promise.resolve({}),
		};
		const manager = new ColorCoderManager({ vault } as any, 'ColorCoder-board', {
			databaseFileName: 'ColorCoder-board',
			defaultBoardConfig: { schema: [], views: [] },
			colorRules: [],
			pageSize: 30,
		} as any);

		const result = await manager.createBoard('Folder');

		expect(result.path).toBe('Folder/ColorCoder-board.md');
	});
});

describe('getAvailableProperties', () => {
	it('collects all non-internal property names from tasks', () => {
		const manager = new ColorCoderManager({ vault: {} }, 'board.json');
		const makeTask = (overrides: Partial<TaskFileSchema>): TaskFileSchema => ({
			_file: 'a.md',
			_title: 'A',
			id: '1',
			title: 'A',
			createdAt: '',
			updatedAt: '',
			...overrides,
		});
		const tasks = [
			makeTask({ status: 'todo', Team: 'Alpha', Sprint: 'S5' }),
			makeTask({ _file: 'b.md', status: 'done', Team: 'Beta' }),
		];

		const props = manager.getAvailableProperties(tasks);
		// `status` is a real user property now — it must surface in pickers.
		expect(props).toContain('status');
		expect(props).toContain('Team');
		expect(props).toContain('Sprint');
		expect(props.some(p => p.startsWith('_'))).toBe(false);
	});

	it('returns empty for no tasks', () => {
		const manager = new ColorCoderManager({ vault: {} }, 'board.json');
		expect(manager.getAvailableProperties([])).toEqual([]);
	});

	it('omits keys that are empty on every task', () => {
		const manager = new ColorCoderManager({ vault: {} }, 'board.json');
		const makeTask = (overrides: Partial<TaskFileSchema>): TaskFileSchema => ({
			_file: 'a.md',
			_title: 'A',
			id: '1',
			title: 'A',
			createdAt: '',
			updatedAt: '',
			...overrides,
		});
		const tasks = [
			makeTask({ status: 'todo', Team: 'Alpha' }),
			makeTask({ _file: 'b.md', status: 'done' }),
		];

		const props = manager.getAvailableProperties(tasks);
		expect(props).toContain('status');
		expect(props).toContain('Team');
		// Empty on every task → dropped from pickers.
		expect(props).not.toContain('dueDate');
		expect(props).not.toContain('assignee');
		expect(props).not.toContain('projectId');
		expect(props).not.toContain('tags');
	});

	it('hides only the structural canonical keys', () => {
		const manager = new ColorCoderManager({ vault: {} }, 'board.json');
		const makeTask = (overrides: Partial<TaskFileSchema>): TaskFileSchema => ({
			_file: 'a.md',
			_title: 'A',
			id: '1',
			title: 'A',
			status: 'todo',
			priority: 'high',
			timeRemaining: '30 min',
			projectId: 'p1',
			tags: ['x'],
			dueDate: '2026-01-01',
			assignee: 'me',
			createdAt: '2026-01-01',
			updatedAt: '2026-01-02',
			...overrides,
		});
		const tasks = [makeTask({})];

		const props = manager.getAvailableProperties(tasks);
		// Real user properties are kept — even the ones that used to be canonical.
		expect(props).toContain('status');
		expect(props).toContain('priority');
		expect(props).toContain('timeRemaining');
		expect(props).toContain('projectId');
		expect(props).toContain('tags');
		expect(props).toContain('dueDate');
		expect(props).toContain('assignee');
		// Auto-maintained timestamp fields are hidden.
		expect(props).not.toContain('updatedAt');
		expect(props).not.toContain('createdAt');
		// Structural keys injected by readTask are hidden.
		expect(props).not.toContain('id');
		expect(props).not.toContain('title');
	});
});

describe('getTasksForBoard', () => {
	it('excludes the board file itself from the task list', async () => {
		const board = { path: 'folder/MyBoard.md', name: 'MyBoard.md', basename: 'MyBoard', parent: { path: 'folder' }, extension: 'md' };
		const taskFile = { path: 'folder/task.md', name: 'task.md', basename: 'task', parent: { path: 'folder' }, extension: 'md' };
		const boardContent = '---\nccBoard: true\nschema: []\nviews: []\npageSize: 30\ncardFontSize: 18\n---\n';
		const vault = {
			cachedRead: (f: any) => Promise.resolve(f === board ? boardContent : '---\nStatus: To do\n---\n'),
			getAbstractFileByPath: (p: string) =>
				p === 'folder' ? { children: [taskFile, board] }
				: p === 'folder/task.md' ? taskFile
				: p === 'folder/MyBoard.md' ? board
				: null,
			read: (f: any) => Promise.resolve(f === board ? boardContent : '---\nStatus: To do\n---\n'),
			modify: () => Promise.resolve(),
		};
		const manager = new ColorCoderManager({ vault } as any, 'MyBoard', {
			defaultBoardConfig: { schema: [], views: [] },
		} as any);

		const result = await manager.getTasksForBoard(board as any);

		expect(result.success).toBe(true);
		expect(result.data?.length).toBe(1);
		expect(result.data?.[0]._file).toBe('folder/task.md');
	});

	it('excludes every board file in the folder, not just the current one', async () => {
		const board = { path: 'folder/MyBoard.md', name: 'MyBoard.md', basename: 'MyBoard', parent: { path: 'folder' }, extension: 'md' };
		const otherBoard = { path: 'folder/Other-board.md', name: 'Other-board.md', basename: 'Other-board', parent: { path: 'folder' }, extension: 'md' };
		const taskFile = { path: 'folder/task.md', name: 'task.md', basename: 'task', parent: { path: 'folder' }, extension: 'md' };
		const boardContent = '---\nccBoard: true\nschema: []\nviews: []\ncolorRules: []\n---\n';
		const vault = {
			cachedRead: (f: any) => Promise.resolve(f === board || f === otherBoard ? boardContent : '---\nStatus: To do\n---\n'),
			getAbstractFileByPath: (p: string) =>
				p === 'folder' ? { children: [taskFile, board, otherBoard] }
				: p === 'folder/task.md' ? taskFile
				: p === 'folder/MyBoard.md' ? board
				: p === 'folder/Other-board.md' ? otherBoard
				: null,
			read: (f: any) => Promise.resolve(f === board || f === otherBoard ? boardContent : '---\nStatus: To do\n---\n'),
			modify: () => Promise.resolve(),
		};
		const manager = new ColorCoderManager({ vault } as any, 'MyBoard', {
			defaultBoardConfig: { schema: [], views: [] },
		} as any);

		const result = await manager.getTasksForBoard(board as any);

		expect(result.success).toBe(true);
		expect(result.data?.length).toBe(1);
		expect(result.data?.[0]._file).toBe('folder/task.md');
	});
});

describe('autoAdoptProperties', () => {
	const makeVault = (boardContent: string) => {
		const board = { path: 'folder/MyBoard.md', name: 'MyBoard.md', basename: 'MyBoard', parent: { path: 'folder' }, extension: 'md' };
		const writes: string[] = [];
		const vault = {
			cachedRead: () => Promise.resolve(boardContent),
			modify: (_f: any, content: string) => { writes.push(content); return Promise.resolve(); },
		};
		return { board, vault, writes };
	};

	const makeTask = (overrides: Partial<TaskFileSchema>): TaskFileSchema => ({
		_file: 'folder/t.md',
		_title: 'T',
		id: '1',
		title: 'T',
		createdAt: '',
		updatedAt: '',
		...overrides,
	});

	it('adopts newly detected task properties into the board schema', async () => {
		const { board, vault, writes } = makeVault('---\nccBoard: true\nschema: []\nviews: []\n---\n');
		const manager = new ColorCoderManager({ vault } as any, 'MyBoard');

		await manager.autoAdoptProperties(board as any, [makeTask({ Status: 'To do', Priority: 'High' })]);

		expect(writes.length).toBe(1);
		expect(writes[0]).toContain('"id":"Status"');
		expect(writes[0]).toContain('"id":"Priority"');
	});

	it('does not re-adopt properties already in the schema', async () => {
		const content = '---\nccBoard: true\nschema: [{"id":"Status","name":"Status","type":"text","visible":true}]\nviews: []\n---\n';
		const { board, vault, writes } = makeVault(content);
		const manager = new ColorCoderManager({ vault } as any, 'MyBoard');

		await manager.autoAdoptProperties(board as any, [makeTask({ Status: 'To do' })]);

		expect(writes.length).toBe(0);
	});

	it('does not re-adopt properties the user explicitly excluded', async () => {
		const content = '---\nccBoard: true\nschema: [{"id":"Status","name":"Status","type":"text","visible":true,"excluded":true}]\nviews: []\n---\n';
		const { board, vault, writes } = makeVault(content);
		const manager = new ColorCoderManager({ vault } as any, 'MyBoard');

		await manager.autoAdoptProperties(board as any, [makeTask({ Status: 'To do' })]);

		expect(writes.length).toBe(0);
	});
});

describe('getVaultPropertyStats', () => {
	const makeVault = (files: Record<string, string>) => ({
		getMarkdownFiles: () => Object.keys(files).map(path => ({ path, name: path.split('/').pop(), extension: 'md' })),
		read: (file: any) => Promise.resolve(files[file.path]),
	});

	it('collects real properties and skips board files and hallucinated keys', async () => {
		const vault = makeVault({
			'a.md': '---\nStatus: To do\nPriority: !!!\nupdatedAt: 2026-01-02\n---\nbody',
			'b.md': '---\nStatus: Done\n---\n',
			'board-board.md': '---\nschema: []\nviews: []\ncolorRules: []\n---\n',
		});
		const manager = new ColorCoderManager({ vault }, 'board.json');

		const stats = await manager.getVaultPropertyStats();
		const keys = stats.map(s => s.key);

		expect(keys).toContain('Status');
		expect(keys).toContain('Priority');
		// Auto-maintained timestamp fields are hidden.
		expect(keys).not.toContain('updatedAt');
		expect(keys).not.toContain('createdAt');
		// Board config keys (schema/views/colorRules) must not leak into the property list.
		expect(keys).not.toContain('schema');
		expect(keys).not.toContain('views');
		expect(keys).not.toContain('colorRules');
		// Hallucinated canonical keys are not reported.
		expect(keys).not.toContain('priority');
		expect(keys).not.toContain('timeRemaining');

		const status = stats.find(s => s.key === 'Status');
		expect(status?.count).toBe(2);
		expect(status?.values).toContain('To do');
	});
});

describe('updateViewConfig', () => {
	it('persists view changes to the board file', async () => {
		const modify = vi.fn();
		const file = { path: 'folder/board-board.md' };
		const boardContent = serializeBoardConfig({
			schema: [],
			views: [{ id: 'default', type: 'board', filters: [], sorts: [], hiddenColumns: [], columnWidths: {}, groupByColumnId: 'status' }],
		});
		const vault = {
			cachedRead: () => Promise.resolve(boardContent),
			modify,
		};
		const manager = new ColorCoderManager({ vault }, 'board.json');
		const updater = (view: ViewConfig): ViewConfig => ({ ...view, groupByColumnId: 'Team' });

		const ok = await manager.updateViewConfig(file as any, updater);

		expect(ok).toBe(true);
		expect(modify).toHaveBeenCalledTimes(1);
		const newContent = modify.mock.calls[0][1] as string;
		expect(newContent).toContain('Team');
	});
});

describe('cleanupRareProperties', () => {
	const makeVault = (files: Record<string, string>) => {
		const modified = new Map<string, string>();
		return {
			getMarkdownFiles: () => Object.keys(files).map(path => ({ path, name: path.split('/').pop(), extension: 'md' })),
			read: (file: any) => Promise.resolve(files[file.path]),
			modify: (file: any, content: string) => {
				modified.set(file.path, content);
				return Promise.resolve();
			},
			_modified: modified,
		};
	};

	it('removes properties used in fewer than minUses files, keeping system keys', async () => {
		const vault = makeVault({
			'a.md': '---\nStatus: To do\nRareTag: x\n---\nbody',
			'b.md': '---\nStatus: Done\nRareTag: y\n---\n',
			'c.md': '---\nStatus: To do\n---\n',
		});
		const manager = new ColorCoderManager({ vault }, 'board.json');

		const result = await manager.cleanupRareProperties(3);

		expect(result.success).toBe(true);
		// RareTag appears in 2 files (< 3) → removed from both.
		expect(result.data).toEqual({ RareTag: 2 });
		// Status appears in 3 files → kept.
		expect(vault._modified.get('a.md')).toContain('Status: To do');
		expect(vault._modified.get('a.md')).not.toContain('RareTag');
		expect(vault._modified.get('b.md')).not.toContain('RareTag');
		// c.md unchanged (no rare key).
		expect(vault._modified.has('c.md')).toBe(false);
	});

	it('returns empty when every property is used enough', async () => {
		const vault = makeVault({
			'a.md': '---\nStatus: To do\n---\n',
			'b.md': '---\nStatus: Done\n---\n',
		});
		const manager = new ColorCoderManager({ vault }, 'board.json');

		const result = await manager.cleanupRareProperties(2);
		expect(result.success).toBe(true);
		expect(result.data).toEqual({});
		expect(vault._modified.size).toBe(0);
	});
});

describe('per-board color rules', () => {
	const rule = { id: 'r1', name: 'R', kind: 'condition', columnId: 'Status', operator: 'is', value: 'x', backgroundColor: '#fff', textColor: '#000', priority: 0 };
	const boardFile = { path: 'a/ColorCoder-board.md', name: 'ColorCoder-board.md', extension: 'md', parent: { path: 'a' } };

	const makeVault = (content: string) => {
		const writes: string[] = [];
		const vault = {
			getRoot: () => ({ children: [boardFile] }),
			cachedRead: () => Promise.resolve(content),
			modify: (_f: any, c: string) => { writes.push(c); return Promise.resolve(); },
		};
		return { vault, writes };
	};

	it('migrates global rules into boards that lack their own snapshot', async () => {
		const { vault, writes } = makeVault('---\nccBoard: true\nschema: []\nviews: []\n---\n');
		const settings = { databaseFileName: 'ColorCoder-board', defaultBoardConfig: { schema: [], views: [] }, colorRules: [rule] };
		const manager = new ColorCoderManager({ vault } as any, 'ColorCoder-board', settings as any);

		const n = await manager.migrateBoardColorRules();

		expect(n).toBe(1);
		expect(writes[0]).toContain('colorRules');
	});

	it('does not overwrite boards that already have their own rules', async () => {
		const { vault, writes } = makeVault('---\nccBoard: true\nschema: []\nviews: []\ncolorRules: [{"id":"own"}]\n---\n');
		const settings = { databaseFileName: 'ColorCoder-board', defaultBoardConfig: { schema: [], views: [] }, colorRules: [rule] };
		const manager = new ColorCoderManager({ vault } as any, 'ColorCoder-board', settings as any);

		const n = await manager.migrateBoardColorRules();

		expect(n).toBe(0);
		expect(writes).toHaveLength(0);
	});

	it('applyDefaultsToAllBoards overrides every board with the plugin defaults', async () => {
		const { vault, writes } = makeVault('---\nccBoard: true\nschema: [{"id":"Old"}]\nviews: []\n---\n');
		const settings = {
			databaseFileName: 'ColorCoder-board',
			defaultBoardConfig: { schema: [{ id: 'New', name: 'New', type: 'text', visible: true }], views: [] },
			colorRules: [rule],
			pageSize: 25,
		};
		const manager = new ColorCoderManager({ vault } as any, 'ColorCoder-board', settings as any);

		const n = await manager.applyDefaultsToAllBoards();

		expect(n).toBe(1);
		expect(writes[0]).toContain('"id":"New"');
		expect(writes[0]).toContain('pageSize: 25');
		expect(writes[0]).toContain('colorRules');
	});
});
