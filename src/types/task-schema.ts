import type { InlineFieldMeta } from './index';

export interface TaskFileFrontmatter {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	[key: string]: unknown;
}

export interface TaskFileSchema {
	_file: string;
	_title: string;
	_body?: string;
	_inlineFields?: Record<string, InlineFieldMeta>;
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	[key: string]: unknown;
}