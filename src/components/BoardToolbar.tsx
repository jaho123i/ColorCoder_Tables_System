import * as React from 'react';

export interface BoardToolbarProps {
	viewName?: string;
	onAddTask?: () => void;
	properties?: string[];
	groupBy?: string;
	swimlaneBy?: string;
	onGroupByChange?: (property: string) => void;
	onSwimlaneByChange?: (property: string) => void;
	onCustomize?: () => void;
	/** Compact mode: Customize and Add task become icon-only buttons. */
	compactMode?: boolean;
}

export default ({
	viewName,
	onAddTask,
	properties = [],
	groupBy,
	swimlaneBy,
	onGroupByChange,
	onSwimlaneByChange,
	onCustomize,
	compactMode = false,
}: BoardToolbarProps) => {
	const hasPicker = properties.length > 0 && (onGroupByChange || onSwimlaneByChange);

	return (
		<div className={`board-toolbar${compactMode ? ' is-compact' : ''}`}>
			<span className="board-toolbar-title">{viewName ?? 'Board'}</span>
			{hasPicker && (
				<div className="board-toolbar-pickers">
					<select
						className="dropdown"
						value={groupBy ?? ''}
						onChange={e => onGroupByChange?.(e.target.value)}
						title="Column grouping property"
					>
						<option value="" disabled>Group by…</option>
						{properties.map(p => <option key={p} value={p}>{p}</option>)}
					</select>
					<select
						className="dropdown"
						value={swimlaneBy ?? ''}
						onChange={e => onSwimlaneByChange?.(e.target.value)}
						title="Swimlane property"
					>
						<option value="" disabled>Swimlane by…</option>
						{properties.map(p => <option key={p} value={p}>{p}</option>)}
					</select>
				</div>
			)}
			{!hasPicker && (
				<span className="board-toolbar-hint" title="No properties found in this board's tasks yet">
					No properties found
				</span>
			)}
			{onCustomize && (
				<button
					className={`board-toolbar-customize${compactMode ? ' is-compact' : ''}`}
					onClick={onCustomize}
					title="Customize board"
					aria-label="Customize board"
				>
					{compactMode ? (
						<svg className="cc-toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
							<path d="M12 22a10 10 0 1 1 10-10c0 2.2-1.8 4-4 4h-2.5a2.5 2.5 0 0 0-1.9 4.1c.4.5.4 1.2 0 1.7-.5.7-1.2 1.2-1.6 1.2Z" />
							<circle cx="7.5" cy="11.5" r="1" fill="currentColor" />
							<circle cx="11" cy="7.5" r="1" fill="currentColor" />
							<circle cx="16" cy="8.5" r="1" fill="currentColor" />
						</svg>
					) : (
						'Customize'
					)}
				</button>
			)}
			{onAddTask && (
				<button
					className={`board-toolbar-add${compactMode ? ' is-compact' : ''}`}
					onClick={onAddTask}
					title="Add task"
					aria-label="Add task"
				>
					{compactMode ? (
						<svg className="cc-toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
							<path d="M12 5v14" />
							<path d="M5 12h14" />
						</svg>
					) : (
						'+ Add task'
					)}
				</button>
			)}
		</div>
	);
};