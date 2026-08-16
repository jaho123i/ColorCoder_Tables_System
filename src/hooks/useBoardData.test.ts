import { describe, it, expect } from 'vitest';
import { buildColumns, buildSwimlanes, resolveGroupField, resolveSwimlaneField, BoardColumnData } from './useBoardData';
import { TaskFileSchema } from '../types/task-schema';
import { ViewConfig } from '../types/index';

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

const baseView: ViewConfig = {
	id: 'default',
	type: 'board',
	filters: [],
	sorts: [],
	hiddenColumns: [],
	columnWidths: {},
	groupByColumnId: 'status',
};

// The tasks below carry `status`/`priority` as real (extra) properties.
const PROPS = ['status', 'priority'];

describe('Board data helpers', () => {
	it('buildColumns groups tasks by the group field', () => {
		const tasks = [
			createTask({ _file: 'a.md', status: 'todo' }),
			createTask({ _file: 'b.md', status: 'todo' }),
			createTask({ _file: 'c.md', status: 'done' }),
		];

		const columns = buildColumns(tasks, baseView, undefined, [], undefined, PROPS);
		expect(columns.map(c => c.title)).toEqual(['done', 'todo']);
		expect(columns.find(c => c.title === 'todo')?.tasks).toHaveLength(2);
		expect(columns.find(c => c.title === 'done')?.tasks).toHaveLength(1);
	});

	it('respects boardColumnOrder', () => {
		const tasks = [
			createTask({ _file: 'a.md', status: 'todo' }),
			createTask({ _file: 'c.md', status: 'done' }),
		];

		const columns = buildColumns(tasks, { ...baseView, boardColumnOrder: ['done', 'todo'] }, undefined, [], undefined, PROPS);
		expect(columns.map(c => c.title)).toEqual(['done', 'todo']);
	});

	it('shows empty groups from the universe by default', () => {
		const tasks = [createTask({ _file: 'a.md', status: 'todo' })];
		const universe = [
			createTask({ _file: 'a.md', status: 'todo' }),
			createTask({ _file: 'b.md', status: 'done' }),
			createTask({ _file: 'c.md', status: 'blocked' }),
		];

		const columns = buildColumns(tasks, baseView, universe, [], undefined, PROPS);
		expect(columns.map(c => c.title)).toEqual(['blocked', 'done', 'todo']);
		expect(columns.find(c => c.title === 'done')?.tasks).toHaveLength(0);
	});

	it('shows groups with tasks in universe even when boardHideEmpty is on', () => {
		const tasks = [createTask({ _file: 'a.md', status: 'todo' })];
		const universe = [
			createTask({ _file: 'a.md', status: 'todo' }),
			createTask({ _file: 'b.md', status: 'done' }),
		];

		const columns = buildColumns(tasks, { ...baseView, boardHideEmpty: true }, universe, [], undefined, PROPS);
		// Both groups visible (done has tasks in universe), but done has 0 tasks in current view
		expect(columns.map(c => c.title)).toEqual(['done', 'todo']);
		expect(columns.find(c => c.title === 'done')?.tasks).toHaveLength(0);
		expect(columns.find(c => c.title === 'todo')?.tasks).toHaveLength(1);
	});

	it('hides truly empty groups (0 in universe) when boardHideEmpty is on', () => {
		const tasks = [createTask({ _file: 'a.md', status: 'todo' })];
		const universe = [
			createTask({ _file: 'a.md', status: 'todo' }),
			// 'done' not in universe = truly empty
		];

		const columns = buildColumns(tasks, { ...baseView, boardHideEmpty: true }, universe, [], undefined, PROPS);
		expect(columns.map(c => c.title)).toEqual(['todo']);
	});

	it('orders tasks within a group by boardTaskOrder', () => {
		const tasks = [
			createTask({ _file: 'a.md', status: 'todo' }),
			createTask({ _file: 'b.md', status: 'todo' }),
			createTask({ _file: 'c.md', status: 'todo' }),
			createTask({ _file: 'd.md', status: 'done' }),
		];

		const columns = buildColumns(tasks, {
			...baseView,
			boardTaskOrder: { 'status:todo': ['c.md', 'a.md', 'b.md'] },
		}, undefined, [], undefined, PROPS);
		const todo = columns.find(c => c.title === 'todo')!;
		expect(todo.tasks.map(t => t._file)).toEqual(['c.md', 'a.md', 'b.md']);
	});

	it('appends tasks not listed in boardTaskOrder after ordered ones', () => {
		const tasks = [
			createTask({ _file: 'a.md', status: 'todo' }),
			createTask({ _file: 'b.md', status: 'todo' }),
			createTask({ _file: 'c.md', status: 'todo' }),
		];

		const columns = buildColumns(tasks, {
			...baseView,
			boardTaskOrder: { 'status:todo': ['c.md'] },
		}, undefined, [], undefined, PROPS);
		const todo = columns.find(c => c.title === 'todo')!;
		expect(todo.tasks.map(t => t._file)).toEqual(['c.md', 'a.md', 'b.md']);
	});

	it('buildSwimlanes returns empty when no swimlane column is set', () => {
		expect(buildSwimlanes([createTask()], baseView)).toEqual([]);
	});

	it('buildSwimlanes groups tasks into lanes by the swimlane field', () => {
		const tasks = [
			createTask({ _file: 'a.md', priority: 'high' }),
			createTask({ _file: 'b.md', priority: 'high', status: 'done' }),
			createTask({ _file: 'c.md', priority: 'low' }),
		];

		const lanes = buildSwimlanes(tasks, { ...baseView, swimlaneColumnId: 'priority' }, [], undefined, PROPS);
		expect(lanes.map(l => l.name)).toEqual(['high', 'low']);

		const high = lanes.find(l => l.name === 'high')!;
		expect(high.columns.some((c: BoardColumnData) => c.title === 'done')).toBe(true);

		// Columns stay consistent across lanes: 'done' has no tasks in 'low',
		// but still shows as an empty column from the base universe.
		const low = lanes.find(l => l.name === 'low')!;
		expect(low.columns.map((c: BoardColumnData) => c.title)).toEqual(['done', 'todo']);
	});
});

describe('resolveGroupField / resolveSwimlaneField', () => {
	const view: ViewConfig = {
		id: 'default',
		type: 'board',
		filters: [],
		sorts: [],
		hiddenColumns: [],
		columnWidths: {},
	};

	it('uses the explicit group-by when set', () => {
		expect(resolveGroupField({ ...view, groupByColumnId: 'Team' }, ['Status', 'Team'])).toBe('Team');
	});

	it('keeps an explicit group-by that is a real detected property', () => {
		expect(resolveGroupField({ ...view, groupByColumnId: 'status' }, ['status', 'Team'])).toBe('status');
	});

	it('falls back from a legacy canonical key that no longer exists', () => {
		expect(resolveGroupField({ ...view, groupByColumnId: 'status' }, ['Status', 'Team'])).toBe('Status');
		expect(resolveSwimlaneField({ ...view, swimlaneColumnId: 'priority' }, ['Status', 'Team'])).toBe('Team');
	});

	it('prefers a case-insensitive match when falling back from a legacy key', () => {
		// Legacy `status` should map to the detected `Status`, not the first property.
		expect(resolveGroupField({ ...view, groupByColumnId: 'status' }, ['Priority', 'Status', 'Time'])).toBe('Status');
	});

	it('defaults group-by to the first detected property', () => {
		expect(resolveGroupField(view, ['Status', 'Team'])).toBe('Status');
	});

	it('falls back to title when no properties are detected', () => {
		expect(resolveGroupField(view, [])).toBe('title');
	});

	it('uses the explicit swimlane when set', () => {
		expect(resolveSwimlaneField({ ...view, swimlaneColumnId: 'Owner' }, ['Status', 'Team'])).toBe('Owner');
	});

	it('defaults swimlane to the second detected property', () => {
		expect(resolveSwimlaneField(view, ['Status', 'Team'])).toBe('Team');
	});

	it('leaves swimlane off when fewer than two properties are detected', () => {
		expect(resolveSwimlaneField(view, ['Status'])).toBeUndefined();
		expect(resolveSwimlaneField(view, [])).toBeUndefined();
	});
});
