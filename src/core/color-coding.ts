import { TaskFileSchema } from '../types/task-schema';
import { ColorRule, FilterOperator, GradientValueConfig } from '../types/index';

export interface ColorOutput {
  bgColor: string;
  textColor: string;
  borderColor?: string;
}

function getFieldValue(task: TaskFileSchema, fieldId: string): unknown {
  // Exact key first, then case-insensitive fallback so a rule on `Priority`
  // still matches the normalized `priority` field (and vice versa).
  if (fieldId in task) return task[fieldId];
  const lower = fieldId.toLowerCase();
  for (const key of Object.keys(task)) {
    if (key.toLowerCase() === lower) return task[key];
  }
  return undefined;
}

function evaluateCondition(value: unknown, operator: FilterOperator, conditionValue: string): boolean {
  if (value === null || value === undefined) {
    return operator === 'is_empty' || operator === 'is_not';
  }

  const strValue = String(value).toLowerCase();
  const condition = conditionValue.toLowerCase();

  switch (operator) {
    case 'is':
      return strValue === condition;
    case 'is_not':
      return strValue !== condition;
    case 'contains':
      return strValue.includes(condition);
    case 'not_contains':
      return !strValue.includes(condition);
    case 'starts_with':
      return strValue.startsWith(condition);
    case 'ends_with':
      return strValue.endsWith(condition);
    case 'gt':
      return !isNaN(Number(value)) && !isNaN(Number(conditionValue)) && Number(value) > Number(conditionValue);
    case 'lt':
      return !isNaN(Number(value)) && !isNaN(Number(conditionValue)) && Number(value) < Number(conditionValue);
    case 'gte':
      return !isNaN(Number(value)) && !isNaN(Number(conditionValue)) && Number(value) >= Number(conditionValue);
    case 'lte':
      return !isNaN(Number(value)) && !isNaN(Number(conditionValue)) && Number(value) <= Number(conditionValue);
    case 'is_checked':
      return value === true || value === 'true';
    case 'is_unchecked':
      return value === false || value === 'false';
    case 'is_empty':
      return value === '' || value === null || value === undefined;
    case 'is_not_empty':
      return value !== '' && value !== null && value !== undefined;
    default:
      return false;
  }
}

export const DEFAULT_COLOR_RULES: ColorRule[] = [
  // Priority-based coloring — matches the user's own `Priority` property
  // (getFieldValue matches case-insensitively, so `priority` works too).
  {
    id: 'priority-high',
    name: 'High Priority',
    columnId: 'Priority',
    operator: 'is',
    value: 'high',
    backgroundColor: '#FF5252',
    textColor: '#FFFFFF',
    priority: 3,
  },
  {
    id: 'priority-medium',
    name: 'Medium Priority',
    columnId: 'Priority',
    operator: 'is',
    value: 'medium',
    backgroundColor: '#FFB74D',
    textColor: '#212121',
    priority: 2,
  },
  {
    id: 'priority-low',
    name: 'Low Priority',
    columnId: 'Priority',
    operator: 'is',
    value: 'low',
    backgroundColor: '#81C784',
    textColor: '#212121',
    priority: 1,
  },
  {
    id: 'priority-none',
    name: 'No Priority',
    columnId: 'Priority',
    operator: 'is',
    value: '',
    backgroundColor: '#9E9E9E',
    textColor: '#FFFFFF',
    priority: 0,
  },
  // Time-based coloring — matches the user's own `Due Date` property.
  {
    id: 'time-overdue',
    name: 'Overdue',
    columnId: 'Due Date',
    operator: 'is_not_empty',
    value: '',
    backgroundColor: '#F44336',
    textColor: '#FFFFFF',
    priority: 5,
  },
  {
    id: 'time-today',
    name: 'Due Today',
    columnId: 'Due Date',
    operator: 'is_not_empty',
    value: '',
    backgroundColor: '#FF9800',
    textColor: '#212121',
    priority: 4,
  },
];

export function computeColor(task: TaskFileSchema, colorRules: ColorRule[]): ColorOutput {
  // If no custom rules provided, use defaults
  const rulesToUse = colorRules.length > 0 ? colorRules : DEFAULT_COLOR_RULES;
  return applyColorRules(task, rulesToUse);
}

export function applyColorRules(task: TaskFileSchema, colorRules: ColorRule[]): ColorOutput {
  // Sort rules by priority (higher priority first)
  const sortedRules = [...colorRules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  
  // Default color (gray)
  let result: ColorOutput = {
    bgColor: '#9E9E9E',
    textColor: '#FFFFFF',
    borderColor: '#9E9E9E',
  };
  
  for (const rule of sortedRules) {
    if (rule.kind === 'gradient') {
      const gradient = applyGradientRule(task, rule);
      if (gradient) { result = gradient; break; }
      continue;
    }

    const fieldValue = getFieldValue(task, rule.columnId);
    const conditionValue = rule.value;
    
    if (evaluateCondition(fieldValue, rule.operator, conditionValue)) {
      result = {
        bgColor: rule.backgroundColor,
        textColor: rule.textColor,
        borderColor: rule.backgroundColor,
      };
      break; // First match wins
    }
  }
  
  return result;
}

/** Interpolate a hex color between two hex colors at t in [0,1]. */
function lerpHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 0xff) + (((pb >> 16) & 0xff) - ((pa >> 16) & 0xff)) * t);
  const g = Math.round(((pa >> 8) & 0xff) + (((pb >> 8) & 0xff) - ((pa >> 8) & 0xff)) * t);
  const bl = Math.round((pa & 0xff) + ((pb & 0xff) - (pa & 0xff)) * t);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1).toUpperCase()}`;
}

/**
 * Color of one gradient point, interpolated through the nearest defined
 * anchors (endpoints always count; overridden middle points are anchors too).
 * This is the SAME interpolation the gradient editor's auto circles use, so a
 * card on the board always shows the exact color the editor previews.
 */
export function gradientColorAt(
  rule: ColorRule,
  values: GradientValueConfig[],
  index: number,
  key: 'color' | 'textColor',
  autoKey: 'auto' | 'autoText'
): string {
  const cfg = values[index];
  const overridden = autoKey === 'auto' ? (cfg.auto === false && cfg.color) : (cfg.autoText === false && cfg.textColor);
  if (overridden) return (key === 'color' ? cfg.color : cfg.textColor) as string;

  const start = key === 'color' ? (rule.gradientStart ?? '#4CAF50') : (rule.gradientTextStart ?? '#FFFFFF');
  const end = key === 'color' ? (rule.gradientEnd ?? '#F44336') : (rule.gradientTextEnd ?? '#FFFFFF');

  // Endpoints use the gradient's start/end colors exactly.
  if (index === 0) return start;
  if (index === values.length - 1) return end;

  let left = -1, right = values.length;
  for (let j = 0; j < values.length; j++) {
    const c = values[j];
    const def = autoKey === 'auto' ? (c.auto === false && c.color) : (c.autoText === false && c.textColor);
    if (j === 0 || j === values.length - 1 || def) {
      if (j < index) left = j;
      else if (j > index && right === values.length) right = j;
    }
  }
  const leftColor = left === -1 ? start : (autoKey === 'auto' ? (values[left].color ?? start) : (values[left].textColor ?? start));
  const rightColor = right === values.length ? end : (autoKey === 'auto' ? (values[right].color ?? end) : (values[right].textColor ?? end));
  const span = right - left;
  const t = span <= 0 ? 0 : (index - left) / span;
  return lerpHex(leftColor, rightColor, t);
}

/**
 * Gradient rule: colors a task by where its value sits in the rule's ordered
 * value list (first value = start color, last value = end color, middle values
 * interpolated). Returns null when the rule doesn't match the task so callers
 * fall through to the next rule.
 */
function applyGradientRule(task: TaskFileSchema, rule: ColorRule): ColorOutput | null {
  const values = rule.gradientValues ?? [];
  if (values.length === 0) return null;
  const fieldValue = getFieldValue(task, rule.columnId);
  if (fieldValue === null || fieldValue === undefined || fieldValue === '') return null;
  const str = String(fieldValue).toLowerCase();
  const idx = values.findIndex(v => String(v.value).toLowerCase() === str);
  if (idx === -1) return null;

  const bgColor = gradientColorAt(rule, values, idx, 'color', 'auto');
  const textColor = gradientColorAt(rule, values, idx, 'textColor', 'autoText');
  return { bgColor, textColor, borderColor: bgColor };
}

/**
 * Color for a group panel (a whole column/swimlane) from the color rules that
 * match its value. Returns null when no rule matches, so the panel stays
 * untinted. Uses the same matching/interpolation as card coloring.
 */
export function computeGroupColor(fieldId: string, value: string, colorRules: ColorRule[]): ColorOutput | null {
  const rulesToUse = colorRules.length > 0 ? colorRules : DEFAULT_COLOR_RULES;
  const sortedRules = [...rulesToUse].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  for (const rule of sortedRules) {
    if (rule.kind === 'gradient') {
      if (rule.columnId.toLowerCase() !== fieldId.toLowerCase()) continue;
      const values = rule.gradientValues ?? [];
      if (values.length === 0) continue;
      const idx = values.findIndex(v => String(v.value).toLowerCase() === value.toLowerCase());
      if (idx === -1) continue;
      const bgColor = gradientColorAt(rule, values, idx, 'color', 'auto');
      const textColor = gradientColorAt(rule, values, idx, 'textColor', 'autoText');
      return { bgColor, textColor, borderColor: bgColor };
    }
    if (rule.columnId.toLowerCase() !== fieldId.toLowerCase()) continue;
    if (evaluateCondition(value, rule.operator, rule.value)) {
      return { bgColor: rule.backgroundColor, textColor: rule.textColor, borderColor: rule.backgroundColor };
    }
  }
  return null;
}

/** Convert a #RRGGBB hex color to an rgba() string with the given alpha. */
export function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  if (isNaN(n)) return hex;
  const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export class ColorCodingEngineImpl {
  computeColor(task: TaskFileSchema, colorRules: ColorRule[]): ColorOutput {
    return computeColor(task, colorRules);
  }

  applyColorRules(task: TaskFileSchema, colorRules: ColorRule[]): ColorOutput {
    return applyColorRules(task, colorRules);
  }
}

export const colorCodingEngine = new ColorCodingEngineImpl();