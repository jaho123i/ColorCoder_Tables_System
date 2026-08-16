import { useState } from 'react';
import { TaskFileSchema } from '../types/task-schema';
import { BoardConfig, ColorRule, ViewConfig, DEFAULT_VIEW } from '../types/index';
import { getGroups, reorderGroups } from '../core/virtual-grouping';
import { applySegments, SegmentResult } from '../core/segmented-view';
import { computeColor, computeGroupColor, ColorOutput } from '../core/color-coding';

export interface BoardColumnData {
	id: string;
	title: string;
	tasks: TaskFileSchema[];
	hidden: boolean;
	/** Group-panel color from the color rules matching this group's value (or null). */
	color: ColorOutput | null;
}

export interface BoardSwimlaneData {
	id: string;
	name: string;
	columns: BoardColumnData[];
	hidden: boolean;
	/** Group-panel color from the color rules matching this lane's value (or null). */
	color: ColorOutput | null;
}

export interface BoardData {
	columns: BoardColumnData[];
	swimlanes: BoardSwimlaneData[];
	segments: SegmentResult[];
	activeSegmentId: string | null;
	setActiveSegment: (segmentId: string | null) => void;
	colorFor: (task: TaskFileSchema) => ColorOutput;
}

/** Legacy canonical keys stored by older boards (status/priority/…) that are
 *  no longer real properties. When a board still references one, fall back to
 *  a detected property instead of grouping by a field that no longer exists. */
const LEGACY_CANONICAL_KEYS = new Set([
	'status', 'priority', 'timeRemaining', 'projectId', 'tags', 'dueDate', 'assignee',
]);

/** When a legacy key falls back, prefer the detected property that matches it
 *  case-insensitively (legacy `status` → detected `Status`). */
function legacyMatch(legacyKey: string, properties: string[]): string | undefined {
	return properties.find(p => p.toLowerCase() === legacyKey.toLowerCase());
}

/** Resolve the effective group-by field: the board's explicit choice (unless
 *  it is a legacy canonical key that no longer exists), else the first
 *  detected user property, else `title`. Never a hardcoded canonical key. */
export function resolveGroupField(view: ViewConfig, properties: string[]): string {
	const explicit = view.groupByColumnId;
	if (explicit && (properties.includes(explicit) || !LEGACY_CANONICAL_KEYS.has(explicit))) return explicit;
	if (explicit && LEGACY_CANONICAL_KEYS.has(explicit)) {
		const match = legacyMatch(explicit, properties);
		if (match) return match;
	}
	return properties[0] ?? 'title';
}

/** Resolve the effective swimlane field: the board's explicit choice (unless
 *  it is a legacy canonical key), else the second detected property (so boards
 *  with several properties still get lanes), else none. */
export function resolveSwimlaneField(view: ViewConfig, properties: string[]): string | undefined {
	const explicit = view.swimlaneColumnId;
	if (explicit && (properties.includes(explicit) || !LEGACY_CANONICAL_KEYS.has(explicit))) return explicit;
	if (explicit && LEGACY_CANONICAL_KEYS.has(explicit)) {
		const match = legacyMatch(explicit, properties);
		if (match) return match;
	}
	return properties.length > 1 ? properties[1] : undefined;
}

/** Distinct non-empty values of a field across tasks (the group "universe"). */
function distinctValues(tasks: TaskFileSchema[], fieldId: string): string[] {
	const seen = new Set<string>();
	for (const t of tasks) {
		const v = t[fieldId];
		if (v === undefined || v === null || v === '') continue;
		if (Array.isArray(v)) {
			for (const item of v) seen.add(String(item));
		} else {
			seen.add(String(v));
		}
	}
	return [...seen];
}

export function buildColumns(
	tasks: TaskFileSchema[],
	view: ViewConfig,
	universe: TaskFileSchema[] = tasks,
	colorRules: ColorRule[] = [],
	propertyOptions?: string[],
	properties?: string[]
): BoardColumnData[] {
	const groupByColumnId = resolveGroupField(view, properties ?? []);
	const direction = view.groupSortDirection ?? 'asc';
	// Default to false (show empty groups) unless explicitly set to true.
	// Be extra defensive: treat undefined, null, false, "false" as false; only true === true hides.
	const hideEmpty = view.boardHideEmpty === true;
	const hidden = view.hiddenGroups ?? [];

	// Get all group values from universe (all tasks in board folder).
	// This ensures groups with ANY tasks in the board are always visible.
	const universeGroups = getGroups(universe, groupByColumnId, direction);

	// Also include values from property options that have 0 tasks in universe
	// (truly empty groups). These are controlled by "Show groups that have no tasks".
	const allValues = new Set<string>();
	for (const g of universeGroups) allValues.add(g.label);
	if (propertyOptions) {
		for (const v of propertyOptions) allValues.add(v);
	} else {
		// Fallback: distinct values from universe
		for (const v of distinctValues(universe, groupByColumnId)) allValues.add(v);
	}

	// Filter each group's tasks to only those in the current view (tasks).
	const taskSet = new Set(tasks.map(t => t._file));

	// Build groups for ALL values (including truly empty ones).
	let orderedGroups = [...allValues].map(value => {
		const existing = universeGroups.find(g => g.label === value);
		const tasksInUniverse = existing?.tasks ?? [];
		const tasksInView = tasksInUniverse.filter(t => taskSet.has(t._file));
		return {
			key: `${groupByColumnId}:${value}`,
			label: value,
			tasks: tasksInView,
			count: tasksInUniverse.length,
			collapsed: false,
		};
	});

	// If "Show groups that have no tasks" is OFF, remove groups that have
	// 0 tasks in the universe (truly empty groups).
	if (hideEmpty) {
		orderedGroups = orderedGroups.filter(g => g.count > 0);
	}

	// "Stable" order follows the property's option order dynamically, so
	// reordering options in Properties reorders the columns automatically.
	if (view.groupSortMode === 'stable' && propertyOptions && propertyOptions.length > 0) {
		orderedGroups = reorderGroups(
			orderedGroups,
			propertyOptions.map(label => `${groupByColumnId}:${label}`)
		);
	} else if (view.boardColumnOrder && view.boardColumnOrder.length > 0) {
		orderedGroups = reorderGroups(
			orderedGroups,
			view.boardColumnOrder.map(label => `${groupByColumnId}:${label}`)
		);
	}

	return orderedGroups.map(group => {
		// Apply per-group card order when one is stored; keep unlisted tasks after in original order.
		const order = view.boardTaskOrder?.[group.key];
		let groupTasks = group.tasks;
		if (order && order.length > 0) {
			const byFile = new Map(groupTasks.map(t => [t._file, t]));
			const sorted: TaskFileSchema[] = [];
			for (const f of order) {
				const t = byFile.get(f);
				if (t) {
					sorted.push(t);
					byFile.delete(f);
				}
			}
			groupTasks = [...sorted, ...byFile.values()];
		}
		return {
			id: group.key,
			title: group.label,
			tasks: groupTasks,
			hidden: hidden.includes(group.key),
			color: computeGroupColor(groupByColumnId, group.label, colorRules),
		};
	});
}

export function buildSwimlanes(
	tasks: TaskFileSchema[],
	view: ViewConfig,
	colorRules: ColorRule[] = [],
	propertyOptions?: string[],
	properties?: string[]
): BoardSwimlaneData[] {
	const swimlaneColumnId = resolveSwimlaneField(view, properties ?? []);
	if (!swimlaneColumnId) return [];

	const direction = view.swimlaneSortDirection ?? 'asc';
	let lanes = getGroups(tasks, swimlaneColumnId, direction);
	const hidden = view.hiddenGroups ?? [];

	if (view.swimlaneSortMode === 'stable' && propertyOptions && propertyOptions.length > 0) {
		lanes = reorderGroups(
			lanes,
			propertyOptions.map(label => `${swimlaneColumnId}:${label}`)
		);
	} else if (view.boardSwimlaneOrder && view.boardSwimlaneOrder.length > 0) {
		lanes = reorderGroups(
			lanes,
			view.boardSwimlaneOrder.map(label => `${swimlaneColumnId}:${label}`)
		);
	}

	return lanes.map(lane => ({
		id: lane.key,
		name: lane.label,
		columns: buildColumns(lane.tasks, view, tasks, colorRules, propertyOptions, properties),
		hidden: hidden.includes(lane.key),
		color: computeGroupColor(swimlaneColumnId, lane.label, colorRules),
	}));
}

export const useBoardData = (
	tasks: TaskFileSchema[],
	config: BoardConfig,
	view: ViewConfig,
	colorRules: ColorRule[],
	propertyOptions?: string[],
	properties?: string[]
): BoardData => {
	// Ensure view has all defaults (especially boardHideEmpty) by merging with DEFAULT_VIEW.
	// This is a safety net in case the caller passes a raw view from the config.
	const mergedView: ViewConfig = { ...DEFAULT_VIEW, ...view, boardHideEmpty: view.boardHideEmpty === true };
	const columns = buildColumns(tasks, mergedView, tasks, colorRules, propertyOptions, properties);
	const swimlanes = buildSwimlanes(tasks, mergedView, colorRules, propertyOptions, properties);

	const segments = view.segments
		? applySegments(tasks, view.segments).segments
		: [];

	const [activeSegmentId, setActiveSegment] = useState<string | null>(
		view.activeSegmentId ?? segments[0]?.segment.id ?? null
	);

	const colorFor = (task: TaskFileSchema): ColorOutput => computeColor(task, colorRules);

	return { columns, swimlanes, segments, activeSegmentId, setActiveSegment, colorFor };
};
