import * as React from 'react';
import { TaskFileSchema } from '../types/task-schema';
import { ColorOutput } from '../core/color-coding';
import { BoardColumn } from './BoardColumn';
import { DragAndDropHandlers } from '../hooks/useDragAndDrop';
import { BoardColumnData } from '../hooks/useBoardData';

export interface BoardSwimlaneProps {
	id: string;
	name: string;
	columns: BoardColumnData[];
	colorFor: (task: TaskFileSchema) => ColorOutput;
	dnd: DragAndDropHandlers;
	onCardClick?: (task: TaskFileSchema) => void;
	onBodyPreview?: (task: TaskFileSchema) => void;
	onFieldClick?: (task: TaskFileSchema, field: string) => void;
	onToggleColumnHidden?: (columnId: string) => void;
	cardFields?: string[];
	hidden?: boolean;
	onToggleHidden?: (laneId: string) => void;
	pageSize?: number;
	/** Tint the lane header + its columns with the matching color rule. */
	colorGroupPanels?: boolean;
	/** The lane's color from the color rules (or null). */
	color?: ColorOutput | null;
}

export const BoardSwimlane = ({
	id,
	name,
	columns,
	colorFor,
	dnd,
	onCardClick,
	onBodyPreview,
	onFieldClick,
	onToggleColumnHidden,
	cardFields,
	hidden = false,
	onToggleHidden,
	pageSize = 0,
	colorGroupPanels = false,
	color = null,
}: BoardSwimlaneProps) => {
	const headerStyle = colorGroupPanels && color ? { color: color.bgColor } : undefined;
	// Track drag-over state for the swimlane (highlight when any column is dragged over).
	// Use a boolean with a small timeout to handle column-to-column transitions
	// within the same swimlane without flickering.
	const [isDragOver, setIsDragOver] = React.useState(false);
	const dragLeaveTimer = React.useRef<number | null>(null);
	// Wrap onColumnDrop to include the swimlane ID. Accept the swimlaneId parameter
	// passed by BoardColumn (which receives it as a prop) so the correct target
	// swimlane is always forwarded, even if the component is reused.
	const onColumnDrop = (columnId: string, beforeTaskFile?: string | null, swimlaneId?: string) => (e: React.DragEvent) => {
		dnd.onColumnDrop(columnId, beforeTaskFile, swimlaneId ?? id)(e);
	};
	// Wrap onCardDragStart to include the swimlane ID.
	const onCardDragStart = (task: TaskFileSchema, columnId: string, swimlaneId?: string) => (e: React.DragEvent) => {
		dnd.onCardDragStart(task, columnId, swimlaneId ?? id)(e);
	};

	const handleDragLeave = (e: React.DragEvent) => {
		// Only clear when leaving the swimlane entirely (not a child column).
		if (!e.currentTarget.contains(e.relatedTarget as Node)) {
			// Debounce to allow column-to-column transitions within the swimlane.
			dragLeaveTimer.current = window.setTimeout(() => {
				setIsDragOver(false);
				dragLeaveTimer.current = null;
			}, 50);
		}
	};

	// Capture-phase drag over: fires before child columns' handlers, so we can
	// track swimlane hover even when columns stop propagation.
	const handleDragOverCapture = (e: React.DragEvent) => {
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
		if (dragLeaveTimer.current) {
			window.clearTimeout(dragLeaveTimer.current);
			dragLeaveTimer.current = null;
		}
		setIsDragOver(true);
	};

	// Called by child columns when a drop occurs in this swimlane.
	const handleColumnDrop = React.useCallback(() => {
		setIsDragOver(false);
		if (dragLeaveTimer.current) {
			window.clearTimeout(dragLeaveTimer.current);
			dragLeaveTimer.current = null;
		}
	}, []);

	// Cleanup timer on unmount.
	React.useEffect(() => {
		return () => {
			if (dragLeaveTimer.current) window.clearTimeout(dragLeaveTimer.current);
		};
	}, []);

	// Global dragend handler: clears highlight when any drag operation ends
	// (drop or cancel), even if dragleave doesn't fire on the swimlane.
	React.useEffect(() => {
		const onDragEnd = () => {
			setIsDragOver(false);
			if (dragLeaveTimer.current) {
				window.clearTimeout(dragLeaveTimer.current);
				dragLeaveTimer.current = null;
			}
		};
		window.addEventListener('dragend', onDragEnd);
		return () => window.removeEventListener('dragend', onDragEnd);
	}, []);

	return (
		<div
			className={`board-swimlane${hidden ? ' is-hidden' : ''}${isDragOver ? ' is-drag-over' : ''}`}
			onDragOverCapture={handleDragOverCapture}
			onDragLeave={handleDragLeave}
		>
			<header
				className="board-swimlane-header"
				style={headerStyle}
				onClick={() => onToggleHidden?.(id)}
			>
				<span className="board-swimlane-name">{name}</span>
			</header>
			{!hidden && (
				<div className="board-swimlane-columns">
					{columns.map(column => (
						<BoardColumn
							key={column.id}
							id={column.id}
							title={column.title}
							tasks={column.tasks}
							colorFor={colorFor}
							onCardDragStart={onCardDragStart}
							onCardDragEnd={dnd.onCardDragEnd}
							onColumnDrop={onColumnDrop}
							onColumnDragOver={dnd.onColumnDragOver}
							onCardClick={onCardClick}
							onBodyPreview={onBodyPreview}
							onFieldClick={onFieldClick}
							hidden={column.hidden}
							onToggleHidden={onToggleColumnHidden}
							cardFields={cardFields}
							pageSize={pageSize}
							colorGroupPanels={colorGroupPanels}
							color={column.color}
							swimlaneId={id}
							onSwimlaneDrop={handleColumnDrop}
						/>
					))}
				</div>
			)}
		</div>
	);
};
