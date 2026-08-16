import * as React from 'react';
import { SegmentResult } from '../core/segmented-view';

export interface BoardSegmentTabsProps {
	segments: SegmentResult[];
	activeSegmentId: string | null;
	onSelect: (segmentId: string | null) => void;
}

export default ({ segments, activeSegmentId, onSelect }: BoardSegmentTabsProps) => {
	return (
		<div className="board-segment-tabs">
			<button
				className={`board-segment-tab ${activeSegmentId === null ? 'is-active' : ''}`}
				onClick={() => onSelect(null)}
			>
				All
			</button>
			{segments.map(segment => (
				<button
					key={segment.segment.id}
					className={`board-segment-tab ${activeSegmentId === segment.segment.id ? 'is-active' : ''}`}
					onClick={() => onSelect(segment.segment.id)}
				>
					{segment.segment.name}
				</button>
			))}
		</div>
	);
};
