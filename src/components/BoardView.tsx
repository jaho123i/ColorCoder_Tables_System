import * as React from 'react';
import { TaskFileSchema } from '../types/task-schema';
import { BoardConfig, ViewConfig } from '../types/index';
import { useBoardData, resolveGroupField, resolveSwimlaneField } from '../hooks/useBoardData';
import { useDragAndDrop } from '../hooks/useDragAndDrop';
import BoardToolbar from './BoardToolbar';
import BoardSegmentTabs from './BoardSegmentTabs';
import BoardViewBody from './BoardViewBody';

export interface BoardViewProps {
	tasks: TaskFileSchema[];
	boardConfig: BoardConfig;
	view: ViewConfig;
	colorRules?: import('../types/index').ColorRule[];
	onMoveTask?: (taskFile: string, toColumnId: string, beforeTaskFile?: string | null) => void;
	onAddTask?: () => void;
	onCardClick?: (task: TaskFileSchema) => void;
	onBodyPreview?: (task: TaskFileSchema) => void;
	onFieldClick?: (task: TaskFileSchema, field: string) => void;
	properties?: string[];
	onGroupByChange?: (property: string) => void;
	onSwimlaneByChange?: (property: string) => void;
	onToggleColumnHidden?: (columnId: string) => void;
	onCustomize?: () => void;
	pageSize?: number;
	colorGroupPanels?: boolean;
	cardFontSize?: number;
	compactMode?: boolean;
	/** The group-by property's option order, for "Stable" column ordering. */
	propertyOptions?: string[];
}

const BoardView = ({
	tasks,
	boardConfig,
	view,
	colorRules = [],
	onMoveTask,
	onAddTask,
	onCardClick,
	onBodyPreview,
	onFieldClick,
	properties,
	onGroupByChange,
	onSwimlaneByChange,
	onToggleColumnHidden,
	onCustomize,
	pageSize = 0,
	colorGroupPanels = false,
	cardFontSize = 14,
	compactMode = false,
	propertyOptions,
}: BoardViewProps) => {
	const { columns, swimlanes, segments, activeSegmentId, setActiveSegment, colorFor } = useBoardData(
		tasks,
		boardConfig,
		view,
		colorRules,
		propertyOptions,
		properties
	);
	const dnd = useDragAndDrop(onMoveTask);

	const groupBy = resolveGroupField(view, properties ?? []);
	const swimlaneBy = resolveSwimlaneField(view, properties ?? []);

	const filterBySegment = (taskList: TaskFileSchema[], segmentTasks: TaskFileSchema[]) =>
		taskList.filter(t => segmentTasks.some(at => at._file === t._file));

	// Filter columns/swimlanes to the active segment's tasks when a segment is selected
	const activeSegment = segments.find(s => s.segment.id === activeSegmentId);
	const visibleColumns = activeSegment
		? columns.map(col => ({ ...col, tasks: filterBySegment(col.tasks, activeSegment.tasks) }))
		: columns;
	const visibleSwimlanes = activeSegment
		? swimlanes.map(lane => ({
				...lane,
				columns: lane.columns.map(col => ({
					...col,
					tasks: filterBySegment(col.tasks, activeSegment.tasks),
				})),
		  }))
		: swimlanes;

	return (
		<div
			className="board-view"
			style={{ '--cc-card-font-size': `${cardFontSize}px` } as React.CSSProperties}
		>
			<BoardToolbar
				viewName={view.name}
				onAddTask={onAddTask}
				properties={properties}
				groupBy={groupBy}
				swimlaneBy={swimlaneBy}
				onGroupByChange={onGroupByChange}
				onSwimlaneByChange={onSwimlaneByChange}
				onCustomize={onCustomize}
				compactMode={compactMode}
			/>
			{segments.length > 0 && (
				<BoardSegmentTabs
					segments={segments}
					activeSegmentId={activeSegmentId}
					onSelect={setActiveSegment}
				/>
			)}
			<BoardViewBody
				columns={visibleColumns}
				swimlanes={visibleSwimlanes}
				colorFor={colorFor}
				dnd={dnd}
				onCardClick={onCardClick}
				onBodyPreview={onBodyPreview}
				onFieldClick={onFieldClick}
				onToggleColumnHidden={onToggleColumnHidden}
				cardFields={view.cardFields}
				pageSize={pageSize}
				colorGroupPanels={colorGroupPanels}
			/>
		</div>
	);
};

export default BoardView;
