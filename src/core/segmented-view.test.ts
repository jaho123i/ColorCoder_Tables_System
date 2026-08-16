import { describe, it, expect } from 'vitest';
import {
  applySegments,
  getSegmentTasks,
  reorderSegments,
  toggleSegmentVisibility,
  SegmentedViewEngineImpl,
} from '../core/segmented-view';
import { TaskFileSchema } from '../types/task-schema';
import { SegmentConfig } from '../types/index';

const createTask = (overrides: Partial<TaskFileSchema> = {}): TaskFileSchema => ({
  _file: 'test.md',
  _title: 'Test Task',
  id: 'task-1',
  title: 'Test Task',
  status: 'todo',
  priority: 'medium',
  timeRemaining: '',
  projectId: '',
  tags: [],
  dueDate: '',
  assignee: '',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

const createSegment = (overrides: Partial<SegmentConfig> = {}): SegmentConfig => ({
  id: 'seg-1',
  name: 'Segment 1',
  columnId: 'projectId',
  values: ['project-a'],
  color: '#FF0000',
  ...overrides,
});

describe('SegmentedViewEngine', () => {
  const engine = new SegmentedViewEngineImpl();

  describe('applySegments', () => {
    it('should create segments with matching tasks', () => {
      const tasks = [
        createTask({ id: '1', projectId: 'project-a' }),
        createTask({ id: '2', projectId: 'project-b' }),
        createTask({ id: '3', projectId: 'project-a' }),
      ];
      const segments = [
        createSegment({ id: 'seg-a', name: 'Project A', values: ['project-a'] }),
        createSegment({ id: 'seg-b', name: 'Project B', values: ['project-b'] }),
      ];

      const result = applySegments(tasks, segments);

      expect(result.segments.length).toBe(2);
      expect(result.segments[0].segment.id).toBe('seg-a');
      expect(result.segments[0].tasks.length).toBe(2);
      expect(result.segments[1].segment.id).toBe('seg-b');
      expect(result.segments[1].tasks.length).toBe(1);
      expect(result.segments[0].tasks[0].id).toBe('1');
      expect(result.segments[0].tasks[1].id).toBe('3');
      expect(result.segments[1].tasks[0].id).toBe('2');
    });

    it('should handle tasks with no matching segment values', () => {
      const tasks = [
        createTask({ id: '1', projectId: 'project-a' }),
        createTask({ id: '2', projectId: 'project-b' }),
      ];
      const segments = [
        createSegment({ id: 'seg-a', name: 'Project A', values: ['project-c'] }), // No matches
      ];

      const result = applySegments(tasks, segments);

      expect(result.segments.length).toBe(1);
      expect(result.segments[0].tasks.length).toBe(0);
    });

    it('should handle empty segments array', () => {
      const tasks = [createTask({ id: '1', projectId: 'project-a' })];
      const segments: SegmentConfig[] = [];

      const result = applySegments(tasks, segments);

      expect(result.segments.length).toBe(0);
    });

    it('should handle multiple values in segment', () => {
      const tasks = [
        createTask({ id: '1', projectId: 'project-a' }),
        createTask({ id: '2', projectId: 'project-b' }),
        createTask({ id: '3', projectId: 'project-c' }),
      ];
      const segments = [
        createSegment({ 
          id: 'seg-ab', 
          name: 'Project A or B', 
          values: ['project-a', 'project-b'] 
        }),
      ];

      const result = applySegments(tasks, segments);

      expect(result.segments.length).toBe(1);
      expect(result.segments[0].tasks.length).toBe(2);
      expect(result.segments[0].tasks.map(t => t.id)).toEqual(['1', '2']);
    });

    it('should handle empty string values', () => {
      const tasks = [
        createTask({ id: '1', projectId: '' }),
        createTask({ id: '2', projectId: 'project-a' }),
      ];
      const segments = [
        createSegment({ id: 'seg-empty', name: 'Empty Project', values: [''] }),
      ];

      const result = applySegments(tasks, segments);

      expect(result.segments.length).toBe(1);
      expect(result.segments[0].tasks.length).toBe(1);
      expect(result.segments[0].tasks[0].id).toBe('1');
    });
  });

  describe('getSegmentTasks', () => {
    it('should return tasks for a specific segment', () => {
      const tasks = [
        createTask({ id: '1', projectId: 'project-a' }),
        createTask({ id: '2', projectId: 'project-b' }),
      ];
      const segments = [
        createSegment({ id: 'seg-a', name: 'Project A', values: ['project-a'] }),
        createSegment({ id: 'seg-b', name: 'Project B', values: ['project-b'] }),
      ];
      const segmentedBoard = applySegments(tasks, segments);

      const result = getSegmentTasks(segmentedBoard, 'seg-a');

      expect(result.length).toBe(1);
      expect(result[0].id).toBe('1');
    });

    it('should return empty array for non-existent segment', () => {
      const tasks = [createTask({ id: '1', projectId: 'project-a' })];
      const segments = [createSegment({ id: 'seg-a', name: 'Project A', values: ['project-a'] })];
      const segmentedBoard = applySegments(tasks, segments);

      const result = getSegmentTasks(segmentedBoard, 'non-existent');

      expect(result.length).toBe(0);
    });
  });

  describe('reorderSegments', () => {
    it('should reorder segments according to segmentIds array', () => {
      const tasks = [
        createTask({ id: '1', projectId: 'project-a' }),
        createTask({ id: '2', projectId: 'project-b' }),
        createTask({ id: '3', projectId: 'project-c' }),
      ];
      const segments = [
        createSegment({ id: 'seg-a', name: 'Project A', values: ['project-a'] }),
        createSegment({ id: 'seg-b', name: 'Project B', values: ['project-b'] }),
        createSegment({ id: 'seg-c', name: 'Project C', values: ['project-c'] }),
      ];
      const segmentedBoard = applySegments(tasks, segments);

      const result = reorderSegments(segmentedBoard, ['seg-c', 'seg-a']);

      expect(result.segments.length).toBe(3);
      expect(result.segments[0].segment.id).toBe('seg-c');
      expect(result.segments[1].segment.id).toBe('seg-a');
      expect(result.segments[2].segment.id).toBe('seg-b'); // Remaining segment
    });

    it('should handle partial reordering (some segments not in list)', () => {
      const tasks = [
        createTask({ id: '1', projectId: 'project-a' }),
        createTask({ id: '2', projectId: 'project-b' }),
      ];
      const segments = [
        createSegment({ id: 'seg-a', name: 'Project A', values: ['project-a'] }),
        createSegment({ id: 'seg-b', name: 'Project B', values: ['project-b'] }),
      ];
      const segmentedBoard = applySegments(tasks, segments);

      const result = reorderSegments(segmentedBoard, ['seg-b']); // Only specify one

      expect(result.segments.length).toBe(2);
      expect(result.segments[0].segment.id).toBe('seg-b');
      expect(result.segments[1].segment.id).toBe('seg-a'); // Remaining segment
    });

    it('should return new array (immutability)', () => {
      const tasks = [createTask({ id: '1', projectId: 'project-a' })];
      const segments = [createSegment({ id: 'seg-a', name: 'Project A', values: ['project-a'] })];
      const segmentedBoard = applySegments(tasks, segments);

      const result = reorderSegments(segmentedBoard, ['seg-a']);

      expect(result).not.toBe(segmentedBoard);
    });
  });

  describe('toggleSegmentVisibility', () => {
    it('should toggle visibility of a segment', () => {
      const tasks = [createTask({ id: '1', projectId: 'project-a' })];
      const segments = [createSegment({ id: 'seg-a', name: 'Project A', values: ['project-a'] })];
      let segmentedBoard = applySegments(tasks, segments);

      // Initially visible
      expect(segmentedBoard.segments[0].visible).toBe(true);

      // Toggle to hidden
      segmentedBoard = toggleSegmentVisibility(segmentedBoard, 'seg-a');
      expect(segmentedBoard.segments[0].visible).toBe(false);

      // Toggle back to visible
      segmentedBoard = toggleSegmentVisibility(segmentedBoard, 'seg-a');
      expect(segmentedBoard.segments[0].visible).toBe(true);
    });

    it('should not affect other segments when toggling one', () => {
      const tasks = [
        createTask({ id: '1', projectId: 'project-a' }),
        createTask({ id: '2', projectId: 'project-b' }),
      ];
      const segments = [
        createSegment({ id: 'seg-a', name: 'Project A', values: ['project-a'] }),
        createSegment({ id: 'seg-b', name: 'Project B', values: ['project-b'] }),
      ];
      let segmentedBoard = applySegments(tasks, segments);

      // Toggle first segment
      segmentedBoard = toggleSegmentVisibility(segmentedBoard, 'seg-a');

      // First should be hidden, second should remain visible
      expect(segmentedBoard.segments[0].visible).toBe(false);
      expect(segmentedBoard.segments[1].visible).toBe(true);
    });

    it('should return new array (immutability)', () => {
      const tasks = [createTask({ id: '1', projectId: 'project-a' })];
      const segments = [createSegment({ id: 'seg-a', name: 'Project A', values: ['project-a'] })];
      const segmentedBoard = applySegments(tasks, segments);

      const result = toggleSegmentVisibility(segmentedBoard, 'seg-a');

      expect(result).not.toBe(segmentedBoard);
    });
  });

  describe('SegmentedViewEngineImpl class', () => {
    it('should expose all methods', () => {
      const tasks = [createTask({ id: '1', projectId: 'project-a' })];
      const segments = [createSegment({ id: 'seg-a', name: 'Project A', values: ['project-a'] })];
      const segmentedBoard = applySegments(tasks, segments);

      expect(engine.applySegments(tasks, segments)).toBeInstanceOf(Object);
      expect(engine.getSegmentTasks(segmentedBoard, 'seg-a')).toBeInstanceOf(Array);
      expect(engine.reorderSegments(segmentedBoard, ['seg-a'])).toBeInstanceOf(Object);
      expect(engine.toggleSegmentVisibility(segmentedBoard, 'seg-a')).toBeInstanceOf(Object);
    });
  });
});