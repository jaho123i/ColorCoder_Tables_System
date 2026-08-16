import { TaskFileSchema } from '../types/task-schema';

export interface VirtualGroup {
	key: string;
	label: string;
	tasks: TaskFileSchema[];
	count: number;
	collapsed: boolean;
}

function getFieldValue(task: TaskFileSchema, fieldId: string): unknown {
	return task[fieldId];
}

function normalizeFieldValue(value: unknown): string[] {
	if (value === null || value === undefined) {
		return ['__ungrouped__'];
	}
	if (Array.isArray(value)) {
		return value.length === 0 ? ['__ungrouped__'] : value.map(String);
	}
	const str = String(value).trim();
	return str === '' ? ['__ungrouped__'] : [str];
}

function createGroupKey(fieldId: string, value: string): string {
	if (value === '__ungrouped__') {
		return `__ungrouped__:${fieldId}`;
	}
	return `${fieldId}:${value}`;
}

function createGroupLabel(fieldId: string, value: string): string {
	if (value === '__ungrouped__') {
		return 'Ungrouped';
	}
	return value;
}

export function groupByField(tasks: TaskFileSchema[], fieldId: string): Map<string, TaskFileSchema[]> {
	const groups = new Map<string, TaskFileSchema[]>();

	for (const task of tasks) {
		const rawValue = getFieldValue(task, fieldId);
		const normalizedValues = normalizeFieldValue(rawValue);

		for (const value of normalizedValues) {
			const groupKey = createGroupKey(fieldId, value);
			if (!groups.has(groupKey)) {
				groups.set(groupKey, []);
			}
			groups.get(groupKey)!.push(task);
		}
	}

	return groups;
}

export function getGroups(tasks: TaskFileSchema[], fieldId: string, direction: 'asc' | 'desc' = 'asc'): VirtualGroup[] {
	const grouped = groupByField(tasks, fieldId);
	const groups: VirtualGroup[] = [];

	for (const [groupKey, groupTasks] of grouped.entries()) {
		let value: string;
		if (groupKey.startsWith('__ungrouped__:')) {
			value = '__ungrouped__';
		} else {
			value = groupKey.replace(`${fieldId}:`, '');
		}
		groups.push({
			key: groupKey,
			label: createGroupLabel(fieldId, value),
			tasks: groupTasks,
			count: groupTasks.length,
			collapsed: false,
		});
	}

	groups.sort((a, b) => {
		if (a.key.startsWith('__ungrouped__')) return 1;
		if (b.key.startsWith('__ungrouped__')) return -1;
		const cmp = a.label.localeCompare(b.label);
		return direction === 'desc' ? -cmp : cmp;
	});

	return groups;
}

export function toggleGroupCollapsed(groups: VirtualGroup[], groupKey: string): VirtualGroup[] {
	return groups.map(group =>
		group.key === groupKey
			? { ...group, collapsed: !group.collapsed }
			: group
	);
}

export function reorderGroups(groups: VirtualGroup[], groupKeys: string[]): VirtualGroup[] {
	const groupMap = new Map(groups.map(g => [g.key, g]));
	const reordered: VirtualGroup[] = [];

	for (const key of groupKeys) {
		const group = groupMap.get(key);
		if (group) {
			reordered.push(group);
			groupMap.delete(key);
		}
	}

	for (const group of groupMap.values()) {
		reordered.push(group);
	}

	return reordered;
}

export class VirtualGroupingEngineImpl {
	groupByField(tasks: TaskFileSchema[], fieldId: string): Map<string, TaskFileSchema[]> {
		return groupByField(tasks, fieldId);
	}

	getGroups(tasks: TaskFileSchema[], fieldId: string): VirtualGroup[] {
		return getGroups(tasks, fieldId);
	}

	toggleGroupCollapsed(groups: VirtualGroup[], groupKey: string): VirtualGroup[] {
		return toggleGroupCollapsed(groups, groupKey);
	}

	reorderGroups(groups: VirtualGroup[], groupKeys: string[]): VirtualGroup[] {
		return reorderGroups(groups, groupKeys);
	}
}

export const virtualGroupingEngine = new VirtualGroupingEngineImpl();