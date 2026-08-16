import * as React from 'react';
import { TaskFileSchema } from '../types/task-schema';
import { ColorOutput } from '../core/color-coding';
import { BoardColumn } from './BoardColumn';
import { BoardSwimlane } from './BoardSwimlane';
import { BoardColumnData, BoardSwimlaneData } from '../hooks/useBoardData';
import { DragAndDropHandlers } from '../hooks/useDragAndDrop';

export interface BoardViewBodyProps {
	columns: BoardColumnData[];
	swimlanes: BoardSwimlaneData[];
	colorFor: (task: TaskFileSchema) => ColorOutput;
	dnd: DragAndDropHandlers;
	onCardClick?: (task: TaskFileSchema) => void;
	onBodyPreview?: (task: TaskFileSchema) => void;
	onFieldClick?: (task: TaskFileSchema, field: string) => void;
	onToggleColumnHidden?: (columnId: string) => void;
	cardFields?: string[];
	pageSize?: number;
	colorGroupPanels?: boolean;
}

export default ({ columns, swimlanes, colorFor, dnd, onCardClick, onBodyPreview, onFieldClick, onToggleColumnHidden, cardFields, pageSize = 0, colorGroupPanels = false }: BoardViewBodyProps) => {
	const hasSwimlanes = swimlanes.length > 0;

	if (!hasSwimlanes && columns.length === 0) {
		return <div className="board-empty">No tasks to display</div>;
	}

	if (hasSwimlanes) {
		return (
			<div className="board-swimlanes">
				{swimlanes.map(lane => (
					<BoardSwimlane
						key={lane.id}
						id={lane.id}
						name={lane.name}
						columns={lane.columns}
						colorFor={colorFor}
						dnd={dnd}
						onCardClick={onCardClick}
						onBodyPreview={onBodyPreview}
						onFieldClick={onFieldClick}
						onToggleColumnHidden={onToggleColumnHidden}
						cardFields={cardFields}
						hidden={lane.hidden}
						onToggleHidden={onToggleColumnHidden}
						pageSize={pageSize}
						colorGroupPanels={colorGroupPanels}
						color={lane.color}
					/>
				))}
			</div>
		);
	}

	return (
		<div className="board-columns">
			{columns.map(column => (
				<BoardColumn
					key={column.id}
					id={column.id}
					title={column.title}
					tasks={column.tasks}
					colorFor={colorFor}
					onCardDragStart={dnd.onCardDragStart}
					onCardDragEnd={dnd.onCardDragEnd}
					onColumnDrop={dnd.onColumnDrop}
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
					swimlaneId={undefined}
				/>
			))}
		</div>
	);
};
