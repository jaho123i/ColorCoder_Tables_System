import { TaskFileSchema } from '../types/task-schema';
import { SegmentConfig } from '../types/index';

export interface SegmentedBoard {
  segments: SegmentResult[];
}

export interface SegmentResult {
  segment: SegmentConfig;
  tasks: TaskFileSchema[];
  visible: boolean;
}

export interface SegmentedViewEngine {
  applySegments(tasks: TaskFileSchema[], segments: SegmentConfig[]): SegmentedBoard;
  getSegmentTasks(segmentedBoard: SegmentedBoard, segmentId: string): TaskFileSchema[];
  reorderSegments(segmentedBoard: SegmentedBoard, segmentIds: string[]): SegmentedBoard;
  toggleSegmentVisibility(segmentedBoard: SegmentedBoard, segmentId: string): SegmentedBoard;
}

// Helper function to get field value from task (handles nested paths if needed)
function getFieldValue(task: TaskFileSchema, fieldId: string): unknown {
  return task[fieldId];
}

// Helper function to check if a value matches any of the segment values
function matchesSegmentValue(value: unknown, segmentValues: string[]): boolean {
  if (value === null || value === undefined) {
    return segmentValues.includes('') || segmentValues.includes(null as unknown as string) || 
           segmentValues.includes(undefined as unknown as string);
  }
  
  const strValue = String(value);
  return segmentValues.includes(strValue);
}

export function applySegments(tasks: TaskFileSchema[], segments: SegmentConfig[]): SegmentedBoard {
  const segmentResults: SegmentResult[] = segments.map(segment => {
    const matchedTasks = tasks.filter(task => {
      const value = getFieldValue(task, segment.columnId);
      return matchesSegmentValue(value, segment.values);
    });
    
    return {
      segment,
      tasks: matchedTasks,
      visible: true // Default to visible
    };
  });
  
  return { segments: segmentResults };
}

export function getSegmentTasks(segmentedBoard: SegmentedBoard, segmentId: string): TaskFileSchema[] {
  const segment = segmentedBoard.segments.find(s => s.segment.id === segmentId);
  return segment ? [...segment.tasks] : [];
}

export function reorderSegments(segmentedBoard: SegmentedBoard, segmentIds: string[]): SegmentedBoard {
  const segmentMap = new Map(segmentedBoard.segments.map(s => [s.segment.id, s]));
  const reorderedSegments: SegmentResult[] = [];
  
  // Add segments in the specified order
  for (const id of segmentIds) {
    const segment = segmentMap.get(id);
    if (segment) {
      reorderedSegments.push(segment);
      segmentMap.delete(id);
    }
  }
  
// Add remaining segments in their original order
   for (const segment of Array.from(segmentMap.values())) {
     reorderedSegments.push(segment);
   }
  
  return { segments: reorderedSegments };
}

export function toggleSegmentVisibility(segmentedBoard: SegmentedBoard, segmentId: string): SegmentedBoard {
  const updatedSegments = segmentedBoard.segments.map(segmentResult => {
    if (segmentResult.segment.id === segmentId) {
      return {
        ...segmentResult,
        visible: !segmentResult.visible
      };
    }
    return segmentResult;
  });
  
  return { segments: updatedSegments };
}

export class SegmentedViewEngineImpl {
  applySegments(tasks: TaskFileSchema[], segments: SegmentConfig[]): SegmentedBoard {
    return applySegments(tasks, segments);
  }
  
  getSegmentTasks(segmentedBoard: SegmentedBoard, segmentId: string): TaskFileSchema[] {
    return getSegmentTasks(segmentedBoard, segmentId);
  }
  
  reorderSegments(segmentedBoard: SegmentedBoard, segmentIds: string[]): SegmentedBoard {
    return reorderSegments(segmentedBoard, segmentIds);
  }
  
  toggleSegmentVisibility(segmentedBoard: SegmentedBoard, segmentId: string): SegmentedBoard {
    return toggleSegmentVisibility(segmentedBoard, segmentId);
  }
}

export const segmentedViewEngine = new SegmentedViewEngineImpl();