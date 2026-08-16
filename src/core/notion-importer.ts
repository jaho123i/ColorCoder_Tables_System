import { TaskFileFrontmatter } from '../types/task-schema';

/**
 * Notion Markdown export files carry properties as frontmatter lines:
 *   ---
 *   Status: "02.2026"
 *   Priority: "!!!"
 *   Time: < 15 min
 *   ---
 *
 * Database pages (the export root / archive pages) have no frontmatter;
 * they only contain wiki-links and CSV references and should be skipped.
 */

export interface ParsedNotionTask {
	title: string;
	frontmatter: TaskFileFrontmatter;
	body: string;
	hasFrontmatter: boolean;
}

/** Split a Notion export file into frontmatter map + body. */
export function parseNotionFile(content: string): { properties: Record<string, string>; body: string; hasFrontmatter: boolean } {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) {
		return { properties: {}, body: content.trim(), hasFrontmatter: false };
	}

	const properties: Record<string, string> = {};
	for (const line of match[1].split('\n')) {
		const idx = line.indexOf(':');
		if (idx <= 0) continue;
		const key = line.slice(0, idx).trim();
		let value = line.slice(idx + 1).trim();
		value = value.replace(/^"(.*)"$/, '$1'); // strip surrounding quotes
		if (value !== '') properties[key] = value;
	}

	const body = content.slice(match[0].length).trim();
	return { properties, body, hasFrontmatter: true };
}

/**
 * Convert a Notion export file into a task frontmatter. The plugin is
 * schema-driven, so every Notion property is preserved as-is under its own
 * name — nothing is renamed onto canonical keys.
 */
export function notionalToTaskFrontmatter(properties: Record<string, string>): TaskFileFrontmatter {
	const now = new Date().toISOString();
	return {
		id: '',
		title: '',
		createdAt: now,
		updatedAt: now,
		...properties,
	};
}

/** Build a complete task from a file name + content. */
export function parseNotionTask(fileName: string, content: string): ParsedNotionTask {
	const { properties, body, hasFrontmatter } = parseNotionFile(content);
	const title = fileName.replace(/\.md$/i, '');

	const frontmatter = notionalToTaskFrontmatter(properties);
	frontmatter.title = title;

	return { title, frontmatter, body, hasFrontmatter };
}