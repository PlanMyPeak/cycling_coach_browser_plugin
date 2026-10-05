import { describe, it, expect } from 'vitest';
import {
  declaredCountsFor,
  serializedItemBytes,
  splitIntoPlanImportParts,
  splitSourcesIntoParts,
  totalPartItems,
  PLAN_IMPORT_MAX_PART_ITEMS,
} from '@/export/adapters/planMyPeak/planImportParts';

function items(count: number, size = 0): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) => ({
    workoutId: index + 1,
    title: `Workout ${index + 1}`,
    nested: { nulls: [null, null], keep: 'x'.repeat(size) },
  }));
}

describe('splitIntoPlanImportParts', () => {
  it('splits by item count, zero-based per kind, in order', () => {
    const source = items(120);

    const parts = splitIntoPlanImportParts('plan_workouts', source);

    expect(parts.map((part) => part.items.length)).toEqual([50, 50, 20]);
    expect(parts.map((part) => part.partIndex)).toEqual([0, 1, 2]);
    expect(parts.every((part) => part.kind === 'plan_workouts')).toBe(true);
    expect(parts.flatMap((part) => part.items)).toEqual(source);
  });

  it('never copies or reshapes an item', () => {
    const source = items(3);

    const parts = splitIntoPlanImportParts('calendar_notes', source);

    // Same references, so nothing could have been rewritten on the way.
    parts[0].items.forEach((item, index) => {
      expect(item).toBe(source[index]);
    });
  });

  it('splits by serialized size before the item limit is reached', () => {
    const source = items(10, 1_000);
    const perItem = serializedItemBytes(source[0]) + 1;

    const parts = splitIntoPlanImportParts('plan_workouts', source, {
      maxItems: PLAN_IMPORT_MAX_PART_ITEMS,
      maxBytes: perItem * 3 + 128,
    });

    expect(parts.map((part) => part.items.length)).toEqual([3, 3, 3, 1]);
    expect(parts.flatMap((part) => part.items)).toEqual(source);
  });

  it('sends an oversized item alone rather than dropping it', () => {
    const [small, big, other] = [
      { id: 1 },
      { id: 2, blob: 'y'.repeat(500) },
      { id: 3 },
    ];

    const parts = splitIntoPlanImportParts(
      'plan_workouts',
      [small, big, other],
      { maxItems: 50, maxBytes: 300 }
    );

    expect(parts.map((part) => part.items)).toEqual([[small], [big], [other]]);
  });

  it('returns no parts for an empty kind', () => {
    expect(splitIntoPlanImportParts('rx_workouts', [])).toEqual([]);
  });
});

describe('splitSourcesIntoParts', () => {
  it('orders kinds and restarts the part index per kind', () => {
    const parts = splitSourcesIntoParts({
      planWorkouts: items(60),
      calendarNotes: items(1),
      calendarEvents: [],
      rxWorkouts: items(2),
    });

    expect(parts.map((part) => [part.kind, part.partIndex])).toEqual([
      ['plan_workouts', 0],
      ['plan_workouts', 1],
      ['calendar_notes', 0],
      ['rx_workouts', 0],
    ]);
    expect(totalPartItems(parts)).toBe(63);
  });
});

describe('declaredCountsFor', () => {
  it('counts each native list', () => {
    expect(
      declaredCountsFor({
        planWorkouts: items(4),
        calendarNotes: items(2),
        calendarEvents: items(1),
        rxWorkouts: [],
      })
    ).toEqual({
      planWorkouts: 4,
      calendarNotes: 2,
      calendarEvents: 1,
      rxWorkouts: 0,
    });
  });
});
