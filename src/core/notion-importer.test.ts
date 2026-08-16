import { describe, it, expect } from 'vitest';
import {
	parseNotionFile,
	parseNotionTask,
} from './notion-importer';

describe('Notion importer', () => {
	describe('parseNotionFile', () => {
		it('parses quoted and unquoted frontmatter values', () => {
			const { properties, body, hasFrontmatter } = parseNotionFile(
				'---\nStatus: "02.2026"\nPriority: "!!!"\nTime: < 15 min\n---\n\nSome body'
			);
			expect(hasFrontmatter).toBe(true);
			expect(properties).toEqual({ Status: '02.2026', Priority: '!!!', Time: '< 15 min' });
			expect(body).toBe('Some body');
		});

		it('returns empty properties for a database page (no frontmatter)', () => {
			const { properties, hasFrontmatter } = parseNotionFile('[[Wiki Link]]\n\nCSV ref');
			expect(hasFrontmatter).toBe(false);
			expect(properties).toEqual({});
		});
	});

	describe('parseNotionTask', () => {
		it('builds a task with title from file name and preserves properties as-is', () => {
			const task = parseNotionTask('Kupic leki.md', '---\nStatus: "todo"\nPriority: "!!!"\nTime: < 15 min\n---');
			expect(task.title).toBe('Kupic leki');
			expect(task.frontmatter.title).toBe('Kupic leki');
			expect(task.frontmatter.Status).toBe('todo');
			expect(task.frontmatter.Priority).toBe('!!!');
			expect(task.frontmatter.Time).toBe('< 15 min');
			expect(task.hasFrontmatter).toBe(true);
		});

		it('treats files without frontmatter as untitled tasks', () => {
			const task = parseNotionTask('Database.md', '[[Link]]');
			expect(task.hasFrontmatter).toBe(false);
			expect(task.frontmatter.title).toBe('Database');
		});
	});
});