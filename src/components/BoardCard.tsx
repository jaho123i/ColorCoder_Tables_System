import * as React from 'react';
import { TaskFileSchema } from '../types/task-schema';
import { ColorOutput } from '../core/color-coding';

export interface BoardCardProps {
	task: TaskFileSchema;
	color: ColorOutput;
	draggable?: boolean;
	onDragStart?: (e: React.DragEvent) => void;
	onDragEnd?: () => void;
	onClick?: (task: TaskFileSchema) => void;
	onBodyPreview?: (task: TaskFileSchema) => void;
	onFieldClick?: (task: TaskFileSchema, field: string) => void;
	fields?: string[];
}

const CARD_SKIP_FIELDS = new Set([
	'_file', '_title', '_body', 'id', 'title', 'createdAt', 'updatedAt', 'projectId', 'tags',
]);

export const BoardCard = ({ task, color, draggable, onDragStart, onDragEnd, onClick, onBodyPreview, onFieldClick, fields = [] }: BoardCardProps) => {
	const style = {
		background: color.bgColor,
		color: color.textColor,
		borderLeft: `4px solid ${color.borderColor ?? color.bgColor}`,
	};

	const hasBody = typeof task._body === 'string' && task._body.trim().length > 0;

	return (
		<div
			className="board-card"
			style={style}
			draggable={draggable ?? true}
			onDragStart={onDragStart}
			onDragEnd={onDragEnd}
			onClick={() => onClick?.(task)}
		>
			<span className="board-card-title">
				{task._title}
			</span>
			{fields.length > 0 && (
				<div className="board-card-fields">
					{fields.map(field => {
						const value = task[field];
						if (value === undefined || value === null || value === '') return null;
						if (CARD_SKIP_FIELDS.has(field)) return null;
						const str = Array.isArray(value) ? value.join(', ') : String(value);
						if (!str) return null;
						return (
							<span
								className="board-card-field"
								key={field}
								title="Edit value"
								onClick={e => {
									e.stopPropagation();
									onFieldClick?.(task, field);
								}}
							>
								<span className="board-card-field-name">{field}:</span>
								<span className="board-card-field-value">{str}</span>
							</span>
						);
					})}
				</div>
			)}
			{hasBody && (
				<span
					className="board-card-ellipsis"
					title="Preview notes"
					onClick={e => {
						e.stopPropagation();
						onBodyPreview?.(task);
					}}
				>…</span>
			)}
		</div>
	);
};
