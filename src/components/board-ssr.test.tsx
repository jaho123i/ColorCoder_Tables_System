import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import BoardView from './BoardView';
import { BoardCard } from './BoardCard';
import { BoardColumn } from './BoardColumn';
import { TaskFileSchema } from '../types/task-schema';
import { BoardConfig, DEFAULT_VIEW } from '../types/index';

const DIR = 'Sample Obsidian Vault/Sample post-export files/Notion/Export-90c0da9d-673d-4030-b1bf-9f0d84343ea2/Rzeczy do zrobienia/Gdziekolwiek';

function parseFrontmatterInline(content: string): Record<string, string> {
	const match = content.match(/^---\n([\s\S]*?)\n---/);
	if (!match) return {};
	const out: Record<string, string> = {};
	for (const line of match[1].split('\n')) {
		const idx = line.indexOf(':');
		if (idx > 0) {
			const key = line.slice(0, idx).trim();
			const value = line.slice(idx + 1).trim();
			out[key] = value.replace(/^"(.*)"$/, '$1');
		}
	}
	return out;
}

const view = {
	...DEFAULT_VIEW,
	groupByColumnId: 'status',
	swimlaneColumnId: 'priority',
	boardColumnOrder: ['Todo', 'In Progress', 'Done'],
};

describe('BoardView SSR smoke test (real Notion data)', () => {
	it('renders HTML with cards when given real task data', () => {
		const files = readdirSync(DIR).filter(f => f.endsWith('.md') && !f.endsWith('-board.md'));
		const tasks: TaskFileSchema[] = files.map((f, i) => {
			const fm = parseFrontmatterInline(readFileSync(join(DIR, f), 'utf8'));
			return {
				_file: join(DIR, f),
				_title: f.replace(/\.md$/i, ''),
				id: `task-${i}`,
				title: f.replace(/\.md$/i, ''),
				status: (fm['status'] ?? fm['Status'] ?? 'todo') as any,
				priority: (fm['priority'] ?? fm['Priority'] ?? 'medium') as any,
				timeRemaining: fm['timeRemaining'] ?? fm['Time'] ?? '',
				projectId: '',
				tags: [],
				dueDate: '',
				assignee: '',
				createdAt: '',
				updatedAt: '',
				...fm,
			};
		});

		const html = renderToString(
			React.createElement(BoardView, {
				tasks,
				boardConfig: { schema: [], views: [view] } as BoardConfig,
				view,
				colorRules: [],
				properties: Object.keys(tasks[0]),
			})
		);

		expect(html).toContain('board-view');
		expect(html).toContain('board-toolbar');
		expect((html.match(/board-card/g) ?? []).length).toBeGreaterThan(0);
	});

	it('marks cards that have body text with an ellipsis', () => {
		const task: TaskFileSchema = {
			_file: 'a.md',
			_title: 'A',
			_body: 'some notes here',
			id: '1',
			title: 'A',
			status: 'todo',
			priority: 'medium',
			timeRemaining: '',
			projectId: '',
			tags: [],
			dueDate: '',
			assignee: '',
			createdAt: '',
			updatedAt: '',
		};
		const html = renderToString(
			React.createElement(BoardCard, {
				task,
				color: { bgColor: '#fff', textColor: '#000', borderColor: '#ccc' },
			})
		);
		expect(html).toContain('board-card-ellipsis');
	});

	it('does not mark empty cards with an ellipsis', () => {
		const task: TaskFileSchema = {
			_file: 'a.md',
			_title: 'A',
			id: '1',
			title: 'A',
			status: 'todo',
			priority: 'medium',
			timeRemaining: '',
			projectId: '',
			tags: [],
			dueDate: '',
			assignee: '',
			createdAt: '',
			updatedAt: '',
		};
		const html = renderToString(
			React.createElement(BoardCard, {
				task,
				color: { bgColor: '#fff', textColor: '#000', borderColor: '#ccc' },
			})
		);
		expect(html).not.toContain('board-card-ellipsis');
	});

	it('shows the expand toggle when a column has more cards than the page size', () => {
		const mk = (i: number): TaskFileSchema => ({
			_file: `a${i}.md`,
			_title: `A${i}`,
			id: String(i),
			title: `A${i}`,
			status: 'todo',
			priority: 'medium',
			timeRemaining: '',
			projectId: '',
			tags: [],
			dueDate: '',
			assignee: '',
			createdAt: '',
			updatedAt: '',
		});
		const html = renderToString(
			React.createElement(BoardColumn, {
				id: 'status:todo',
				title: 'Todo',
				tasks: [mk(0), mk(1), mk(2), mk(3)],
				colorFor: () => ({ bgColor: '#fff', textColor: '#000', borderColor: '#ccc' }),
				onCardDragStart: () => () => {},
				onCardDragEnd: () => {},
				onColumnDrop: () => () => {},
				onColumnDragOver: () => {},
				pageSize: 2,
			})
		);
		expect(html).toContain('board-column-show-more');
		expect(html).toContain('Show more (2)');
		expect((html.match(/class="board-card"/g) ?? []).length).toBe(2);
	});

	it('renders every card when the page size is zero (no limit)', () => {
		const mk = (i: number): TaskFileSchema => ({
			_file: `a${i}.md`,
			_title: `A${i}`,
			id: String(i),
			title: `A${i}`,
			status: 'todo',
			priority: 'medium',
			timeRemaining: '',
			projectId: '',
			tags: [],
			dueDate: '',
			assignee: '',
			createdAt: '',
			updatedAt: '',
		});
		const html = renderToString(
			React.createElement(BoardColumn, {
				id: 'status:todo',
				title: 'Todo',
				tasks: [mk(0), mk(1), mk(2)],
				colorFor: () => ({ bgColor: '#fff', textColor: '#000', borderColor: '#ccc' }),
				onCardDragStart: () => () => {},
				onCardDragEnd: () => {},
				onColumnDrop: () => () => {},
				onColumnDragOver: () => {},
				pageSize: 0,
			})
		);
		expect(html).not.toContain('board-column-show-more');
		expect((html.match(/class="board-card"/g) ?? []).length).toBe(3);
	});
});
