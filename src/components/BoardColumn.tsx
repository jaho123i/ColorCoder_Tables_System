import * as React from 'react';
import { setIcon } from 'obsidian';
import { TaskFileSchema } from '../types/task-schema';
import { ColorOutput, hexToRgba } from '../core/color-coding';
import { BoardCard } from './BoardCard';

export interface BoardColumnProps {
	id: string;
	title: string;
	tasks: TaskFileSchema[];
	colorFor: (task: TaskFileSchema) => ColorOutput;
	onCardDragStart: (task: TaskFileSchema, columnId: string, swimlaneId?: string) => (e: React.DragEvent) => void;
	onCardDragEnd: () => void;
	onColumnDrop: (columnId: string, beforeTaskFile?: string | null, swimlaneId?: string) => (e: React.DragEvent) => void;
	onColumnDragOver: (e: React.DragEvent) => void;
	onCardClick?: (task: TaskFileSchema) => void;
	onBodyPreview?: (task: TaskFileSchema) => void;
	onFieldClick?: (task: TaskFileSchema, field: string) => void;
	hidden?: boolean;
	onToggleHidden?: (columnId: string) => void;
	cardFields?: string[];
	/** Max cards shown before a "Show more" control appears (0 = no limit). */
	pageSize?: number;
	/** Tint the panel with its matching color rule (less intense). */
	colorGroupPanels?: boolean;
	/** The group's color from the color rules (or null). */
	color?: ColorOutput | null;
	/** Optional swimlane ID for cross-swimlane drops. */
	swimlaneId?: string;
	/** Called when a drop occurs in this column, to clear parent swimlane highlight. */
	onSwimlaneDrop?: () => void;
}

/** Button that renders an Obsidian icon via setIcon. */
const IconButton = ({
	icon,
	title,
	className,
	onClick,
}: {
	icon: string;
	title: string;
	className?: string;
	onClick: () => void;
}) => {
	const ref = React.useRef<HTMLButtonElement>(null);
	React.useEffect(() => {
		if (ref.current) setIcon(ref.current, icon);
	}, [icon]);
	return <button ref={ref} className={className} title={title} onClick={onClick} />;
};

export const BoardColumn = ({
	id,
	title,
	tasks,
	colorFor,
	onCardDragStart,
	onCardDragEnd,
	onColumnDrop,
	onColumnDragOver,
	onCardClick,
	onBodyPreview,
	onFieldClick,
	hidden = false,
	onToggleHidden,
	cardFields = [],
	pageSize = 0,
	colorGroupPanels = false,
	color = null,
	swimlaneId,
	onSwimlaneDrop,
}: BoardColumnProps) => {
	// Index of the card the dragged tile is currently hovering over; shows an
	// insertion indicator where the card will land. null = not hovering a card.
	const [hoverIndex, setHoverIndex] = React.useState<number | null>(null);
	// Whether the drag is currently over this column (for pane highlight).
	const [isDragOver, setIsDragOver] = React.useState(false);
	// Pagination: show the first `pageSize` cards, with a control to reveal all.
	const [showAll, setShowAll] = React.useState(false);

	const clearHover = () => setHoverIndex(null);

	const limit = pageSize > 0 ? pageSize : Infinity;
	const visibleTasks = showAll || !isFinite(limit) ? tasks : tasks.slice(0, limit);
	const hiddenCount = tasks.length - visibleTasks.length;
	// Pagination applies when the column has more cards than the page size.
	// The toggle stays visible while expanded so the group can be collapsed
	// again ("Show less") — it must not vanish once showAll is true.
	const paginated = pageSize > 0 && tasks.length > pageSize;

	// Group-panel tint: a faint background wash + the title in the rule color.
	const panelStyle = colorGroupPanels && color
		? { background: hexToRgba(color.bgColor, 0.12) }
		: undefined;
	const titleStyle = colorGroupPanels && color
		? { color: color.bgColor }
		: undefined;

	const handleColumnDragOver = (e: React.DragEvent) => {
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
		setIsDragOver(true);
		onColumnDragOver(e);
	};

	const handleColumnDragLeave = (e: React.DragEvent) => {
		// Only clear when leaving the column entirely (not a child card).
		if (!e.currentTarget.contains(e.relatedTarget as Node)) {
			setIsDragOver(false);
			clearHover();
		}
	};

	// Clear highlight on drop (capture phase fires before child stopPropagation).
	const handleColumnDropCapture = () => {
		setIsDragOver(false);
		clearHover();
		onSwimlaneDrop?.();
	};

	return (
		<div
			className={`board-column${hidden ? ' is-hidden' : ''}${isDragOver ? ' is-drag-over' : ''}`}
			data-column-id={id}
			style={panelStyle}
			onDragOver={handleColumnDragOver}
			onDragLeave={handleColumnDragLeave}
			onDropCapture={handleColumnDropCapture}
		>
			{/* Header dropzone: dropping on the header lands at the bottom of the group. */}
			<div
				className="board-column-header-dropzone"
				onDragOver={e => {
					e.preventDefault();
					e.dataTransfer.dropEffect = 'move';
					setHoverIndex(visibleTasks.length);
				}}
				onDragLeave={e => {
					if (!e.currentTarget.contains(e.relatedTarget as Node)) setHoverIndex(null);
				}}
				onDrop={e => {
					e.stopPropagation();
					clearHover();
					onColumnDrop(id, null, swimlaneId)(e);
				}}
			>
				<header className="board-column-header" style={titleStyle}>
					<span className="board-column-title">{title}</span>
					<span className="board-column-header-actions">
						{!hidden && <span className="board-column-count">{tasks.length}</span>}
						<IconButton
							icon={hidden ? 'eye-off' : 'eye'}
							title={hidden ? 'Show group' : 'Hide group'}
							className="board-column-eye"
							onClick={() => onToggleHidden?.(id)}
						/>
					</span>
				</header>
				{hoverIndex === visibleTasks.length && <div className="board-drop-indicator board-drop-indicator-end" />}
			</div>
			{!hidden && (
				<div className="board-column-body">
					{visibleTasks.length === 0 ? (
						// Empty column: single dropzone covering the whole body.
						<div
							className="board-card-dropzone board-dropzone-empty"
							onDragOver={e => {
								e.preventDefault();
								e.dataTransfer.dropEffect = 'move';
								setHoverIndex(0);
							}}
							onDragLeave={e => {
								if (!e.currentTarget.contains(e.relatedTarget as Node)) setHoverIndex(null);
							}}
							onDrop={e => {
								e.stopPropagation();
								clearHover();
								onColumnDrop(id, null, swimlaneId)(e);
							}}
						>
							{hoverIndex === 0 && <div className="board-drop-indicator" />}
						</div>
					) : (
						<>
							{visibleTasks.map((task, index) => (
								<div
									key={task._file}
									className="board-card-dropzone"
									onDragOver={e => {
										e.preventDefault();
										e.dataTransfer.dropEffect = 'move';
										setHoverIndex(index);
									}}
									onDragLeave={e => {
										if (!e.currentTarget.contains(e.relatedTarget as Node)) setHoverIndex(null);
									}}
									onDrop={e => {
										e.stopPropagation();
										clearHover();
										onColumnDrop(id, task._file, swimlaneId)(e);
									}}
								>
									{hoverIndex === index && <div className="board-drop-indicator" />}
									<BoardCard
										task={task}
										color={colorFor(task)}
										onDragStart={onCardDragStart(task, id, swimlaneId)}
										onDragEnd={onCardDragEnd}
									onClick={onCardClick}
									onBodyPreview={onBodyPreview}
									onFieldClick={onFieldClick}
									fields={cardFields}
									/>
								</div>
							))}
							{/* End dropzone: shows indicator after the last card. */}
							<div
								className="board-card-dropzone board-dropzone-end"
								onDragOver={e => {
									e.preventDefault();
									e.dataTransfer.dropEffect = 'move';
									setHoverIndex(visibleTasks.length);
								}}
								onDragLeave={e => {
									if (!e.currentTarget.contains(e.relatedTarget as Node)) setHoverIndex(null);
								}}
								onDrop={e => {
									e.stopPropagation();
									clearHover();
									onColumnDrop(id, null, swimlaneId)(e);
								}}
							>
								{hoverIndex === visibleTasks.length && <div className="board-drop-indicator board-drop-indicator-end" />}
							</div>
						</>
					)}
					{paginated && (
						<button
							className="board-column-show-more"
							onClick={() => setShowAll(v => !v)}
						>
							{showAll ? 'Show less' : `Show more (${hiddenCount})`}
						</button>
					)}
				</div>
			)}
		</div>
	);
};
