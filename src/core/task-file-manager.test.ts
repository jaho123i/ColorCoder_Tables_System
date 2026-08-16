import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskFileManager } from '../core/task-file-manager';
import { PluginSettings } from '../types/plugin-settings';

class MockTFile {
	path: string;
	name: string;
	extension: string;
	parent: MockTFolder | null;

	constructor(path: string) {
		this.path = path;
		this.name = path.split('/').pop() || '';
		this.extension = this.name.split('.').pop() || '';
		this.parent = null;
	}
}

class MockTFolder {
	path: string;
	name: string;
	parent: MockTFolder | null;
	children: (MockTFile | MockTFolder)[];

	constructor(path: string) {
		this.path = path;
		this.name = path.split('/').pop() || '';
		this.parent = null;
		this.children = [];
	}
}

const createMockApp = () => {
	const vault = {
		getAbstractFileByPath: vi.fn(),
		read: vi.fn(),
		create: vi.fn(),
		modify: vi.fn(),
		trash: vi.fn(),
	};
	return {
		vault,
		workspace: {
			getActiveFile: vi.fn(),
		},
	};
};

const mockSettings: PluginSettings = {
	databaseFileName: 'ColorCoder-board',
	defaultBoardConfig: { schema: [], views: [] },
	colorRules: [],
};

describe('TaskFileManager', () => {
	let manager: TaskFileManager;
	let mockApp: ReturnType<typeof createMockApp>;

	beforeEach(() => {
		mockApp = createMockApp();
		manager = new TaskFileManager({ app: mockApp as any, settings: mockSettings });
	});

	describe('parseFrontmatter', () => {
		it('parses valid YAML frontmatter', async () => {
			const content = `---\nid: test-1\ntitle: Test Task\nstatus: todo\npriority: high\n---\nBody content`;
			const mockFile = new MockTFile('test.md');
			mockApp.vault.read.mockResolvedValue(content);
			mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);

			const result = await manager.readTask('test.md');

			expect(result.success).toBe(true);
			expect(result.data?.id).toBe('test-1');
			expect(result.data?.title).toBe('Test Task');
			expect(result.data?.status).toBe('todo');
			expect(result.data?.priority).toBe('high');
		});

		it('returns error for missing frontmatter', async () => {
			const content = 'No frontmatter here';
			const mockFile = new MockTFile('test.md');
			mockApp.vault.read.mockResolvedValue(content);
			mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);

			const result = await manager.readTask('test.md');

			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
		});

		it('preserves Notion-style frontmatter keys as-is', async () => {
			const content = `---\nStatus: To do\nPriority: !!!\nTime: < 60 min\n---\nBody`;
			const mockFile = new MockTFile('Analiza Corpo Rats cz.6.md');
			mockApp.vault.read.mockResolvedValue(content);
			mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);

			const result = await manager.readTask('Analiza Corpo Rats cz.6.md');

			expect(result.success).toBe(true);
			// The plugin is schema-driven — user property names are never renamed.
			expect(result.data?.Status).toBe('To do');
			expect(result.data?.Priority).toBe('!!!');
			expect(result.data?.Time).toBe('< 60 min');
			expect(result.data?.title).toBe('Analiza Corpo Rats cz.6');
		});

		it('quotes numeric-looking strings so they round-trip as strings', async () => {
			// "07.2026" unquoted would be re-read by Obsidian as the number 7.2026,
			// dropping the card out of its "07.2026" column.
			const content = `---\nStatus: "07.2026"\nPriority: !!!\nTime: < 15 min\n---\nBody`;
			const mockFile = new MockTFile('Poprawic CV i wyslac p. Marzenie.md');
			mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockApp.vault.read.mockResolvedValue(content);

			const result = await manager.updateTask('Poprawic CV i wyslac p. Marzenie.md', { priority: 'high' });

			expect(result.success).toBe(true);
			const modifiedContent = mockApp.vault.modify.mock.calls[0][1];
			expect(modifiedContent).toContain('Status: "07.2026"');
			// `!!!` is a YAML tag indicator — it must be quoted on write or it
			// would be read back as a tag, not the priority value.
			expect(modifiedContent).toContain('Priority: "!!!"');
		});

		it('keeps Notion labels and priority dots as plain property values', async () => {
			const content = `---\nStatus: In Progress\nPriority: .\n---\n`;
			const mockFile = new MockTFile('task.md');
			mockApp.vault.read.mockResolvedValue(content);
			mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);

			const result = await manager.readTask('task.md');

			expect(result.data?.Status).toBe('In Progress');
			expect(result.data?.Priority).toBe('.');
		});

		it('keeps typed date properties as strings, never coerces them to numbers', async () => {
			// A date-typed property whose value is numeric-looking (a year, an
			// epoch timestamp) must stay a string, otherwise grouping/rendering
			// breaks — e.g. "2026" becomes the number 2026.
			const content = `---\nYear: 2026\nEpoch: 1700000000000\nPlain: 42\n---\nBody`;
			const mockFile = new MockTFile('task.md');
			mockApp.vault.read.mockResolvedValue(content);
			mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);

			const typed = await manager.readTask('task.md', { Year: 'date', Epoch: 'date', Plain: 'number' });
			const untyped = await manager.readTask('task.md');

			expect(typed.data?.Year).toBe('2026');
			expect(typed.data?.Epoch).toBe('1700000000000');
			// number-typed values are still coerced
			expect(typed.data?.Plain).toBe(42);
			// without a type map nothing is coerced either — number coercion is
			// opt-in via an explicit `number` type, never automatic
			expect(untyped.data?.Year).toBe('2026');
			expect(untyped.data?.Plain).toBe('42');
		});

		it('reads Dataview-style inline fields from the note body', async () => {
			const content = `---\nid: 1\ntitle: Inline task\nstatus: todo\npriority: medium\n---\nNotes about the task\nAssignee:: Anna\n[Reviewer:: Bob]\n(Estimate:: 5)\nPriority:: inline-overrides-nothing`;
			const mockFile = new MockTFile('inline.md');
			mockApp.vault.read.mockResolvedValue(content);
			mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);

			const result = await manager.readTask('inline.md');

			expect(result.success).toBe(true);
			// Inline fields become properties on the task.
			expect(result.data?.Assignee).toBe('Anna');
			expect(result.data?.Reviewer).toBe('Bob');
			expect(result.data?.Estimate).toBe(5); // numeric inline value stays typed
			// Frontmatter wins when the same key exists in both.
			expect(result.data?.priority).toBe('medium');
			// Metadata is captured so editors can write the field back in place.
			expect(result.data?._inlineFields?.Assignee).toMatchObject({ format: 'standalone', rawValue: 'Anna' });
			expect(result.data?._inlineFields?.Reviewer).toMatchObject({ format: 'bracketed' });
			expect(result.data?._inlineFields?.Estimate).toMatchObject({ format: 'parenthesized' });
		});
	});

	describe('createTask', () => {
		const mockCreateSetup = () => {
			const mockFolder = new MockTFolder('folder');
			const mockFile = new MockTFile('folder/Test Task.md');
			mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) =>
				path === 'folder' ? mockFolder : null
			);
			mockApp.vault.create.mockResolvedValue(mockFile);
			return { mockFolder, mockFile };
		};

		it('creates task with only meaningful fields', async () => {
			mockCreateSetup();

			const result = await manager.createTask('folder', { title: 'Test Task' });

			expect(result.success).toBe(true);
			expect(mockApp.vault.create).toHaveBeenCalled();
			const callArgs = mockApp.vault.create.mock.calls[0];
			expect(callArgs[0]).toBe('folder/Test Task.md');
			expect(callArgs[1]).toContain('title: Test Task');
			// Empty canonical defaults are omitted — no id/status/priority noise.
			expect(callArgs[1]).not.toContain('id:');
			expect(callArgs[1]).not.toContain('status:');
			expect(callArgs[1]).not.toContain('priority:');
			expect(callArgs[1]).not.toContain('dueDate:');
		});

		it('writes canonical fields the caller actually provided', async () => {
			mockCreateSetup();

			const result = await manager.createTask('folder', {
				title: 'Test Task',
				status: 'done',
				priority: 'high',
				dueDate: '2026-08-03',
				tags: [],
			});

			expect(result.success).toBe(true);
			const callArgs = mockApp.vault.create.mock.calls[0];
			expect(callArgs[1]).toContain('status: done');
			expect(callArgs[1]).toContain('priority: high');
			expect(callArgs[1]).toContain('dueDate: 2026-08-03');
			// Empty tags array is omitted.
			expect(callArgs[1]).not.toContain('tags:');
		});

		it('returns conflict when a file with the title already exists', async () => {
			const mockFolder = new MockTFolder('folder');
			const mockExisting = new MockTFile('folder/Test Task.md');
			mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) =>
				path === 'folder' ? mockFolder : mockExisting
			);

			const result = await manager.createTask('folder', { title: 'Test Task' });

			expect(result.success).toBe(false);
			expect(result.conflict).toBe(true);
			expect(mockApp.vault.create).not.toHaveBeenCalled();
		});

		it('returns error for non-existent folder', async () => {
			mockApp.vault.getAbstractFileByPath.mockReturnValue(null);

			const result = await manager.createTask('nonexistent', { title: 'Test' });

			expect(result.success).toBe(false);
			expect(result.error?.message).toContain('Folder not found');
		});
	});

	describe('updateTask', () => {
		it('updates task frontmatter immutably', async () => {
			const originalContent = `---\nid: test-1\ntitle: Test Task\nstatus: todo\npriority: medium\n---\nBody`;
			const mockFile = new MockTFile('test.md');
			mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockApp.vault.read.mockResolvedValue(originalContent);

			const result = await manager.updateTask('test.md', { status: 'done', priority: 'high' });

			expect(result.success).toBe(true);
			expect(mockApp.vault.modify).toHaveBeenCalled();
			const modifiedContent = mockApp.vault.modify.mock.calls[0][1];
			expect(modifiedContent).toContain('status: done');
			expect(modifiedContent).toContain('priority: high');
			expect(modifiedContent).toContain('Updated At:');
		});
	});

	describe('deleteTask', () => {
		it('moves file to trash', async () => {
			const mockFile = new MockTFile('test.md');
			mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockApp.vault.trash.mockResolvedValue(undefined);

			const result = await manager.deleteTask('test.md');

			expect(result.success).toBe(true);
			expect(mockApp.vault.trash).toHaveBeenCalledWith(mockFile, true);
		});
	});

	describe('deletePropertyValues', () => {
		it('strips the property from every task file in the folder', async () => {
			const mockFolder = new MockTFolder('folder');
			const task1 = new MockTFile('folder/task1.md');
			const task2 = new MockTFile('folder/task2.md');
			mockFolder.children = [task1, task2];

			mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFolder);
			mockApp.vault.read
				.mockResolvedValueOnce('---\nid: 1\ntitle: A\nstatus: todo\n---\nBody')
				.mockResolvedValueOnce('---\nid: 2\ntitle: B\n---\nBody');

			const result = await manager.deletePropertyValues('folder', 'status');

			expect(result.success).toBe(true);
			expect(result.data).toBe(1);
			expect(mockApp.vault.modify).toHaveBeenCalledTimes(1);
			const modifiedContent = mockApp.vault.modify.mock.calls[0][1];
			expect(modifiedContent).not.toContain('status:');
			expect(modifiedContent).toContain('title: A');
		});
	});

	describe('getTasksInFolder', () => {
		it('collects tasks from folder and subfolders', async () => {
			const mockFolder = new MockTFolder('folder');
			const task1 = new MockTFile('folder/task1.md');
			const subfolder = new MockTFolder('folder/subfolder');
			const task2 = new MockTFile('folder/subfolder/task2.md');
			const note = new MockTFile('folder/note.txt');
			
			subfolder.children = [task2];
			mockFolder.children = [task1, subfolder, note];
			
			mockApp.vault.getAbstractFileByPath
				.mockReturnValueOnce(mockFolder) // for getTasksInFolder('folder')
				.mockReturnValueOnce(task1) // for readTask('folder/task1.md')
				.mockReturnValueOnce(task2); // for readTask('folder/subfolder/task2.md')
			mockApp.vault.read
				.mockResolvedValueOnce(`---\nid: 1\ntitle: Task 1\nstatus: todo\npriority: medium\n---\n`)
				.mockResolvedValueOnce(`---\nid: 2\ntitle: Task 2\nstatus: done\npriority: high\n---\n`);

			const result = await manager.getTasksInFolder('folder', true);

			expect(result.success).toBe(true);
			expect(result.data?.length).toBe(2);
			expect(result.data?.[0].title).toBe('Task 1');
			expect(result.data?.[1].title).toBe('Task 2');
		});
	});

	describe('inferSchemaFromTasks', () => {
		it('infers field types from tasks', () => {
			const tasks = [
				{ id: '1', title: 'Task 1', status: 'todo', priority: 'high', count: 5, tags: ['a', 'b'] },
				{ id: '2', title: 'Task 2', status: 'done', priority: 'low', count: 10, tags: ['c'] },
			];

			const schema = manager.inferSchemaFromTasks(tasks as any);

			expect(schema.id).toBe('number'); // numeric strings are inferred as numbers
			expect(schema.title).toBe('string');
			expect(schema.status).toBe('string');
			expect(schema.priority).toBe('string');
			expect(schema.count).toBe('number');
			expect(schema.tags).toBe('array');
		});

		it('marks mixed types as mixed', () => {
			const tasks = [
				{ id: '1', value: 'text' },
				{ id: '2', value: 123 },
			];

			const schema = manager.inferSchemaFromTasks(tasks as any);

			expect(schema.value).toBe('mixed');
		});
	});
});