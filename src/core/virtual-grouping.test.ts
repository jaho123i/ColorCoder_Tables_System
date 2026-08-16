import { describe, it, expect } from 'vitest';
import {
	groupByField,
	getGroups,
	toggleGroupCollapsed,
	reorderGroups,
	VirtualGroupingEngineImpl,
	VirtualGroup,
} from '../core/virtual-grouping';
import { TaskFileSchema } from '../types/task-schema';

const createTask = (overrides: Partial<TaskFileSchema> = {}): TaskFileSchema => ({
	_file: 'test.md',
	_title: 'Test Task',
	id: 'task-1',
	title: 'Test Task',
	status: 'todo',
	priority: 'medium',
	timeRemaining: '',
	projectId: '',
	tags: [],
	dueDate: '',
	assignee: '',
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	...overrides,
});

describe('VirtualGroupingEngine', () => {
	const engine = new VirtualGroupingEngineImpl();

	describe('groupByField', () => {
		it('groups tasks by single-value field (projectId)', () => {
			const tasks = [
				createTask({ id: '1', projectId: 'proj-a' }),
				createTask({ id: '2', projectId: 'proj-b' }),
				createTask({ id: '3', projectId: 'proj-a' }),
			];

			const groups = groupByField(tasks, 'projectId');

			expect(groups.size).toBe(2);
			expect(groups.get('projectId:proj-a')?.length).toBe(2);
			expect(groups.get('projectId:proj-b')?.length).toBe(1);
		});

		it('groups tasks by multi-value field (tags)', () => {
			const tasks = [
				createTask({ id: '1', tags: ['tag-a', 'tag-b'] }),
				createTask({ id: '2', tags: ['tag-b'] }),
				createTask({ id: '3', tags: ['tag-c'] }),
			];

			const groups = groupByField(tasks, 'tags');

			expect(groups.size).toBe(3);
			expect(groups.get('tags:tag-a')?.length).toBe(1);
			expect(groups.get('tags:tag-b')?.length).toBe(2);
			expect(groups.get('tags:tag-c')?.length).toBe(1);
		});

		it('handles missing/null field values as Ungrouped', () => {
			const tasks = [
				createTask({ id: '1', projectId: 'proj-a' }),
				createTask({ id: '2', projectId: '' }),
				createTask({ id: '3', projectId: null as any }),
				createTask({ id: '4', projectId: undefined as any }),
			];

			const groups = groupByField(tasks, 'projectId');

			expect(groups.size).toBe(2);
			expect(groups.get('projectId:proj-a')?.length).toBe(1);
			expect(groups.get('__ungrouped__:projectId')?.length).toBe(3);
		});

		it('handles empty array as Ungrouped', () => {
			const tasks = [
				createTask({ id: '1', tags: ['tag-a'] }),
				createTask({ id: '2', tags: [] }),
			];

			const groups = groupByField(tasks, 'tags');

			expect(groups.size).toBe(2);
			expect(groups.get('tags:tag-a')?.length).toBe(1);
			expect(groups.get('__ungrouped__:tags')?.length).toBe(1);
		});

		it('works with any custom field', () => {
			const tasks = [
				createTask({ id: '1', customField: 'value-a' }),
				createTask({ id: '2', customField: 'value-b' }),
				createTask({ id: '3', customField: 'value-a' }),
			];

			const groups = groupByField(tasks, 'customField');

			expect(groups.size).toBe(2);
			expect(groups.get('customField:value-a')?.length).toBe(2);
			expect(groups.get('customField:value-b')?.length).toBe(1);
		});
	});

	describe('getGroups', () => {
		it('returns VirtualGroup array with correct structure', () => {
			const tasks = [
				createTask({ id: '1', projectId: 'proj-a' }),
				createTask({ id: '2', projectId: 'proj-b' }),
			];

			const groups = getGroups(tasks, 'projectId');

			expect(groups.length).toBe(2);
			expect(groups[0]).toMatchObject({
				key: expect.any(String),
				label: expect.any(String),
				tasks: expect.any(Array),
				count: expect.any(Number),
				collapsed: false,
			});
		});

		it('sorts groups alphabetically, Ungrouped last', () => {
			const tasks = [
				createTask({ id: '1', projectId: 'zeta' }),
				createTask({ id: '2', projectId: '' }),
				createTask({ id: '3', projectId: 'alpha' }),
			];

			const groups = getGroups(tasks, 'projectId');

			expect(groups[0].label).toBe('alpha');
			expect(groups[1].label).toBe('zeta');
			expect(groups[2].label).toBe('Ungrouped');
		});

		it('includes correct task count', () => {
			const tasks = [
				createTask({ id: '1', projectId: 'proj-a' }),
				createTask({ id: '2', projectId: 'proj-a' }),
				createTask({ id: '3', projectId: 'proj-b' }),
			];

			const groups = getGroups(tasks, 'projectId');

			const projA = groups.find(g => g.label === 'proj-a');
			const projB = groups.find(g => g.label === 'proj-b');

			expect(projA?.count).toBe(2);
			expect(projB?.count).toBe(1);
		});
	});

	describe('toggleGroupCollapsed', () => {
		it('toggles collapsed state for specific group', () => {
			const groups: VirtualGroup[] = [
				{ key: 'projectId:proj-a', label: 'proj-a', tasks: [], count: 1, collapsed: false },
				{ key: 'projectId:proj-b', label: 'proj-b', tasks: [], count: 1, collapsed: false },
			];

			const result = toggleGroupCollapsed(groups, 'projectId:proj-a');

			expect(result[0].collapsed).toBe(true);
			expect(result[1].collapsed).toBe(false);
			expect(result[0].key).toBe('projectId:proj-a');
		});

		it('returns new array (immutability)', () => {
			const groups: VirtualGroup[] = [
				{ key: 'projectId:proj-a', label: 'proj-a', tasks: [], count: 1, collapsed: false },
			];

			const result = toggleGroupCollapsed(groups, 'projectId:proj-a');

			expect(result).not.toBe(groups);
			expect(groups[0].collapsed).toBe(false);
		});
	});

	describe('reorderGroups', () => {
		it('reorders groups according to provided keys', () => {
			const groups: VirtualGroup[] = [
				{ key: 'projectId:proj-a', label: 'proj-a', tasks: [], count: 1, collapsed: false },
				{ key: 'projectId:proj-b', label: 'proj-b', tasks: [], count: 1, collapsed: false },
				{ key: 'projectId:proj-c', label: 'proj-c', tasks: [], count: 1, collapsed: false },
			];

			const result = reorderGroups(groups, ['projectId:proj-c', 'projectId:proj-a']);

			expect(result[0].key).toBe('projectId:proj-c');
			expect(result[1].key).toBe('projectId:proj-a');
			expect(result[2].key).toBe('projectId:proj-b');
		});

		it('preserves groups not in reorder list', () => {
			const groups: VirtualGroup[] = [
				{ key: 'projectId:proj-a', label: 'proj-a', tasks: [], count: 1, collapsed: false },
				{ key: 'projectId:proj-b', label: 'proj-b', tasks: [], count: 1, collapsed: false },
			];

			const result = reorderGroups(groups, ['projectId:proj-b']);

			expect(result.length).toBe(2);
			expect(result[0].key).toBe('projectId:proj-b');
			expect(result[1].key).toBe('projectId:proj-a');
		});

		it('returns new array (immutability)', () => {
			const groups: VirtualGroup[] = [
				{ key: 'projectId:proj-a', label: 'proj-a', tasks: [], count: 1, collapsed: false },
			];

			const result = reorderGroups(groups, ['projectId:proj-a']);

			expect(result).not.toBe(groups);
		});
	});

	describe('VirtualGroupingEngineImpl class', () => {
		it('exposes all methods', () => {
			const tasks = [createTask({ id: '1', projectId: 'proj-a' })];

			expect(engine.groupByField(tasks, 'projectId')).toBeInstanceOf(Map);
			expect(engine.getGroups(tasks, 'projectId')).toBeInstanceOf(Array);
			expect(engine.toggleGroupCollapsed([], 'key')).toBeInstanceOf(Array);
			expect(engine.reorderGroups([], ['key'])).toBeInstanceOf(Array);
		});
	});

	describe('cross-folder virtual grouping', () => {
		it('groups tasks from different folders by shared field', () => {
			const tasks = [
				createTask({ id: '1', _file: 'folder1/task1.md', projectId: 'shared-proj' }),
				createTask({ id: '2', _file: 'folder2/task2.md', projectId: 'shared-proj' }),
				createTask({ id: '3', _file: 'folder3/task3.md', projectId: 'other-proj' }),
			];

			const groups = getGroups(tasks, 'projectId');

			const sharedProj = groups.find(g => g.label === 'shared-proj');
			expect(sharedProj?.count).toBe(2);
			expect(sharedProj?.tasks.map(t => t._file)).toEqual(['folder1/task1.md', 'folder2/task2.md']);
		});
	});
});