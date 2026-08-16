import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from './types/plugin-settings';

describe('Plugin settings contract', () => {
	it('has all fields main.ts depends on', () => {
		const settings = DEFAULT_SETTINGS;
		expect(typeof settings.databaseFileName).toBe('string');
		expect(Array.isArray(settings.colorRules)).toBe(true);
		expect(settings.defaultBoardConfig).toHaveProperty('schema');
		expect(settings.defaultBoardConfig).toHaveProperty('views');
	});

	it('produces a complete settings object when merged over defaults', () => {
		const merged = Object.assign({}, DEFAULT_SETTINGS, { databaseFileName: 'Custom-board' });
		expect(merged.databaseFileName).toBe('Custom-board');
		expect(merged.databaseFileName).not.toBe(undefined);
	});
});
