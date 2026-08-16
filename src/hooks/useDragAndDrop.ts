import { useCallback, useState, type DragEvent } from 'react';
import { TaskFileSchema } from '../types/task-schema';

export interface DragState {
	taskFile: string | null;
	columnId: string | null;
	swimlaneId: string | null;
}

export interface DragAndDropHandlers {
	dragState: DragState;
	onCardDragStart: (task: TaskFileSchema, columnId: string, swimlaneId?: string) => (e: DragEvent) => void;
	onCardDragEnd: () => void;
	onColumnDrop: (columnId: string, beforeTaskFile?: string | null, swimlaneId?: string) => (e: DragEvent) => void;
	onColumnDragOver: (e: DragEvent) => void;
	onMoveTask: (taskFile: string, toColumnId: string, beforeTaskFile?: string | null, swimlaneId?: string) => void;
}

export const useDragAndDrop = (
	onMoveTask?: (taskFile: string, toColumnId: string, beforeTaskFile?: string | null, swimlaneId?: string) => void
): DragAndDropHandlers => {
	const [dragState, setDragState] = useState<DragState>({ taskFile: null, columnId: null, swimlaneId: null });

	const onCardDragStart = useCallback(
		(task: TaskFileSchema, columnId: string, swimlaneId?: string) => (e: DragEvent) => {
			e.dataTransfer.setData('text/plain', task._file);
			e.dataTransfer.effectAllowed = 'move';
			setDragState({ taskFile: task._file, columnId, swimlaneId: swimlaneId ?? null });
		},
		[]
	);

	const onCardDragEnd = useCallback(() => {
		setDragState({ taskFile: null, columnId: null, swimlaneId: null });
	}, []);

	const onColumnDrop = useCallback(
		(columnId: string, beforeTaskFile: string | null = null, swimlaneId?: string) => (e: DragEvent) => {
			e.preventDefault();
			const taskFile = dragState.taskFile;
			if (taskFile) {
				onMoveTask?.(taskFile, columnId, beforeTaskFile, swimlaneId);
			}
			setDragState({ taskFile: null, columnId: null, swimlaneId: null });
		},
		[dragState, onMoveTask]
	);

	const onColumnDragOver = useCallback((e: DragEvent) => {
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
	}, []);

	return { dragState, onCardDragStart, onCardDragEnd, onColumnDrop, onColumnDragOver, onMoveTask: onMoveTask ?? (() => {}) };
};
