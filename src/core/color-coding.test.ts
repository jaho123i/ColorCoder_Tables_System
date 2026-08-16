import { describe, it, expect } from 'vitest';
import {
  computeColor,
  applyColorRules,
  ColorCodingEngineImpl,
  DEFAULT_COLOR_RULES,
} from '../core/color-coding';
import { TaskFileSchema } from '../types/task-schema';
import { FilterOperator, ColorRule } from '../types/index';

const createTask = (overrides: Partial<TaskFileSchema> = {}): TaskFileSchema => ({
  _file: 'test.md',
  _title: 'Test Task',
  id: 'task-1',
  title: 'Test Task',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe('ColorCodingEngine', () => {
  const engine = new ColorCodingEngineImpl();

  describe('applyColorRules', () => {
    it('returns default color when no rules provided', () => {
      const task = createTask({ Priority: 'high' });
      const color = applyColorRules(task, []);

      // Should return default gray color when no rules provided
      expect(color.bgColor).toBe('#9E9E9E');
      expect(color.textColor).toBe('#FFFFFF');
      expect(color.borderColor).toBe('#9E9E9E');
    });

    it('applies first matching rule when multiple rules match', () => {
      const task = createTask({ Priority: 'high', Status: 'done' });
      const rules = [
        {
          id: 'rule1',
          name: 'Rule 1',
          columnId: 'Priority',
          operator: 'is' as FilterOperator,
          value: 'high',
          backgroundColor: '#FF0000',
          textColor: '#FFFFFF',
          priority: 1,
        },
        {
          id: 'rule2',
          name: 'Rule 2',
          columnId: 'Status',
          operator: 'is' as FilterOperator,
          value: 'done',
          backgroundColor: '#00FF00',
          textColor: '#000000',
          priority: 2,
        },
      ];

      const color = applyColorRules(task, rules);

      // Should match rule2 first (higher priority number = higher priority)
      expect(color.bgColor).toBe('#00FF00');
      expect(color.textColor).toBe('#000000');
      expect(color.borderColor).toBe('#00FF00');
    });

    it('uses default color when no rules match', () => {
      const task = createTask({ Priority: 'low' }); // Use a valid priority that doesn't match our rule
      const rules = [
        {
          id: 'rule1',
          name: 'Rule 1',
          columnId: 'Priority',
          operator: 'is' as FilterOperator,
          value: 'high',
          backgroundColor: '#FF0000',
          textColor: '#FFFFFF',
          priority: 1,
        },
      ];

      const color = applyColorRules(task, rules);

      // Should fall back to default gray
      expect(color.bgColor).toBe('#9E9E9E');
      expect(color.textColor).toBe('#FFFFFF');
      expect(color.borderColor).toBe('#9E9E9E');
    });
  });

  describe('computeColor', () => {
    it('uses default rules when no custom rules provided', () => {
      const task = createTask({ Priority: 'high' });
      const color = computeColor(task, []);

      expect(color.bgColor).toBe('#FF5252');
      expect(color.textColor).toBe('#FFFFFF');
      expect(color.borderColor).toBe('#FF5252');
    });

    it('uses custom rules when provided', () => {
      const task = createTask({ Status: 'done' });
      const customRules = [
        {
          id: 'custom-rule',
          name: 'Custom Rule',
          columnId: 'Status',
          operator: 'is' as FilterOperator,
          value: 'done',
          backgroundColor: '#00FF00',
          textColor: '#000000',
          priority: 1,
        },
      ];

      const color = computeColor(task, customRules);

      expect(color.bgColor).toBe('#00FF00');
      expect(color.textColor).toBe('#000000');
      expect(color.borderColor).toBe('#00FF00');
    });
  });

  describe('ColorCodingEngineImpl class', () => {
    it('exposes all methods', () => {
      const task = createTask({ Priority: 'high' });

      expect(engine.computeColor(task, [])).toHaveProperty('bgColor');
      expect(engine.applyColorRules(task, [])).toHaveProperty('bgColor');
    });
  });

  describe('gradient rules', () => {
    const gradientRule: ColorRule = {
      id: 'gradient-priority',
      name: 'Priority gradient',
      kind: 'gradient',
      columnId: 'Priority',
      operator: 'is',
      value: '',
      backgroundColor: '#9E9E9E',
      textColor: '#FFFFFF',
      priority: 10,
      gradientStart: '#000000',
      gradientEnd: '#FFFFFF',
      gradientTextStart: '#000000',
      gradientTextEnd: '#FFFFFF',
      gradientValues: [
        { value: 'low', auto: true, autoText: true },
        { value: 'medium', auto: true, autoText: true },
        { value: 'high', auto: true, autoText: true },
      ],
    };

    it('colors by value position between start and end', () => {
      const first = applyColorRules(createTask({ Priority: 'low' }), [gradientRule]);
      const mid = applyColorRules(createTask({ Priority: 'medium' }), [gradientRule]);
      const last = applyColorRules(createTask({ Priority: 'high' }), [gradientRule]);
      expect(first.bgColor).toBe('#000000');
      expect(mid.bgColor).toBe('#808080');
      expect(last.bgColor).toBe('#FFFFFF');
    });

    it('uses a manual color when auto is off for a value', () => {
      const rule: ColorRule = {
        ...gradientRule,
        gradientValues: [
          { value: 'low', auto: true, autoText: true },
          { value: 'medium', auto: false, color: '#FF0000', autoText: false, textColor: '#00FF00' },
          { value: 'high', auto: true, autoText: true },
        ],
      };
      const color = applyColorRules(createTask({ Priority: 'medium' }), [rule]);
      expect(color.bgColor).toBe('#FF0000');
      expect(color.textColor).toBe('#00FF00');
    });

    it('falls through to the next rule when the value is not in the gradient', () => {
      const condition: ColorRule = {
        id: 'fallback',
        name: 'Fallback',
        columnId: 'Status',
        operator: 'is',
        value: 'todo',
        backgroundColor: '#112233',
        textColor: '#FFFFFF',
        priority: 5,
      };
      const color = applyColorRules(createTask({ Priority: 'critical', Status: 'todo' }), [gradientRule, condition]);
      expect(color.bgColor).toBe('#112233');
    });

    it('skips gradient rules with no values', () => {
      const empty: ColorRule = { ...gradientRule, gradientValues: [] };
      const color = applyColorRules(createTask({ Priority: 'high' }), [empty]);
      expect(color.bgColor).toBe('#9E9E9E');
    });

    it('text interpolates independently from background', () => {
      const rule: ColorRule = {
        ...gradientRule,
        gradientStart: '#000000',
        gradientEnd: '#000000', // flat bg — only text should change
        gradientTextStart: '#000000',
        gradientTextEnd: '#FFFFFF',
      };
      const mid = applyColorRules(createTask({ Priority: 'medium' }), [rule]);
      expect(mid.bgColor).toBe('#000000');
      expect(mid.textColor).toBe('#808080');
    });
  });

  describe('DEFAULT_COLOR_RULES', () => {
    it('contains expected rules', () => {
      expect(DEFAULT_COLOR_RULES.length).toBeGreaterThan(0);
      expect(DEFAULT_COLOR_RULES.some(r => r.id === 'priority-high')).toBe(true);
      expect(DEFAULT_COLOR_RULES.some(r => r.id === 'priority-medium')).toBe(true);
      expect(DEFAULT_COLOR_RULES.some(r => r.id === 'priority-low')).toBe(true);
    });
  });
});