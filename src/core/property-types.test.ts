import { describe, it, expect } from 'vitest';
import { COLUMN_TYPE_OPTIONS, inferPropertyType, normalizePropertyValue } from './property-types';

describe('Date & time merged into Date', () => {
	it('offers a single Date type in the dropdown (no separate Date & time)', () => {
		const values = COLUMN_TYPE_OPTIONS.map(o => o.value);
		expect(values).toContain('date');
		expect(values).not.toContain('datetime');
	});

	it('still infers datetime values so adoption can set the Include time flag', () => {
		expect(inferPropertyType('2026-08-14')).toBe('date');
		expect(inferPropertyType('2026-08-14T12:30')).toBe('datetime');
	});

	it('normalizes a datetime-local picker value to ISO', () => {
		// Native <input type="datetime-local"> yields "YYYY-MM-DDTHH:mm".
		expect(normalizePropertyValue('2026-08-14T12:30', 'datetime')).toBe('2026-08-14T12:30');
		expect(normalizePropertyValue('2026-08-14 12:30', 'datetime')).toBe('2026-08-14T12:30');
		expect(normalizePropertyValue('2026-08-14', 'date')).toBe('2026-08-14');
	});
});
