import { ColumnType } from '../types/index';

/**
 * Property type system that mirrors Obsidian's native Properties types.
 *
 * Obsidian's native types are: text, list/multitext, number, checkbox, date,
 * datetime, tags, aliases. Obsidian infers a property's type from its YAML
 * value (boolean → checkbox, number → number, `YYYY-MM-DD` → date, ISO with a
 * time component → datetime, array → list, else text) and stores the result in
 * `.obsidian/types.json`.
 *
 * We reuse the same inference rules and add our own types on top (select,
 * multiselect, reference, lastEdit). Date and Date & time are ONE type in the
 * dropdown — the "Include time" toggle (withTime) decides the format. The
 * single source of truth for the type dropdown lives here so Settings and the
 * board Customize modal never drift.
 */

/** The types offered in every property type dropdown (Settings + board). */
export const COLUMN_TYPE_OPTIONS: { value: ColumnType; label: string }[] = [
	{ value: 'text', label: 'Text' },
	{ value: 'number', label: 'Number' },
	{ value: 'checkbox', label: 'Checkbox' },
	{ value: 'date', label: 'Date' },
	{ value: 'multiselect', label: 'List (multiple values)' },
	{ value: 'select', label: 'Selection (single)' },
	{ value: 'reference', label: 'Reference (file link)' },
];

/** Types that hold a single scalar value (not an array). */
const SCALAR_TYPES = new Set<ColumnType>(['text', 'number', 'checkbox', 'date', 'datetime', 'select', 'reference']);

export function isScalarType(type: ColumnType): boolean {
	return SCALAR_TYPES.has(type);
}

/** Types that hold multiple values (arrays). */
export function isListType(type: ColumnType): boolean {
	return type === 'multiselect';
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?/;

/**
 * Infer a property type from a raw YAML value, the same way Obsidian does.
 * Used when auto-adopting vault properties so checkboxes/numbers/dates get the
 * right type instead of everything defaulting to text.
 */
export function inferPropertyType(value: unknown): ColumnType {
	if (typeof value === 'boolean') return 'checkbox';
	if (typeof value === 'number') return 'number';
	if (Array.isArray(value)) return 'multiselect';
	if (typeof value === 'string') {
		const v = value.trim();
		if (DATETIME_RE.test(v)) return 'datetime';
		if (DATE_ONLY_RE.test(v)) return 'date';
		if (v === 'true' || v === 'false') return 'checkbox';
		if (v !== '' && !isNaN(Number(v))) return 'number';
	}
	return 'text';
}

/**
 * Normalize a raw value to the shape Obsidian expects for a given type, so the
 * value round-trips correctly (checkbox → boolean, number → number, date →
 * `YYYY-MM-DD`, datetime → ISO, list → array).
 */
export function normalizePropertyValue(value: unknown, type: ColumnType): unknown {
	if (value === undefined || value === null) return value;
	switch (type) {
		case 'checkbox': {
			if (typeof value === 'boolean') return value;
			const s = String(value).trim().toLowerCase();
			return s === 'true' || s === 'yes' || s === '1';
		}
		case 'number': {
			if (typeof value === 'number') return value;
			const n = Number(String(value).trim());
			return isNaN(n) ? value : n;
		}
		case 'date': {
			const s = String(value).trim();
			if (DATE_ONLY_RE.test(s)) return s;
			// Strip any time component so a datetime collapses to a date.
			const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
			return m ? m[1] : value;
		}
		case 'datetime': {
			const s = String(value).trim();
			if (DATETIME_RE.test(s)) return s.replace(' ', 'T');
			if (DATE_ONLY_RE.test(s)) return `${s}T00:00:00`;
			return value;
		}
		case 'multiselect': {
			if (Array.isArray(value)) return value;
			if (typeof value === 'string') {
				const s = value.trim();
				if (s === '') return [];
				return s.split(',').map(v => v.trim()).filter(Boolean);
			}
			return [value];
		}
		default:
			return value;
	}
}