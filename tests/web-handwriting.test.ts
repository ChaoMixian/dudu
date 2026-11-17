import { describe, expect, test } from 'bun:test';
import { HANDWRITING, prepareHandwriting, traceHandwriting } from '../src/web/lib/handwriting';

const line = prepareHandwriting([{ start: [0, 0], curves: [[10, 0, 20, 0, 30, 0]] }], 4);

describe('setup handwriting', () => {
  test('clamps progress and interpolates the current pen position', () => {
    expect(traceHandwriting(line, -1)).toEqual([]);
    expect(traceHandwriting(line, 0)).toEqual([]);
    const trace = traceHandwriting(line, 0.413)[0]!;
    expect(trace.at(-1)!.x).toBeCloseTo(30 * 0.413, 8);
    expect(trace.at(-1)!.y).toBe(0);
    expect(traceHandwriting(line, 2)).toEqual(traceHandwriting(line, 1));
  });

  test('lifts the pen between strokes without drawing a connecting line', () => {
    const word = prepareHandwriting([
      { start: [0, 0], curves: [[10, 0, 20, 0, 30, 0]] },
      { start: [100, 0], curves: [[110, 0, 120, 0, 130, 0]] },
    ], 4);
    const trace = traceHandwriting(word, 0.75);
    expect(word.length).toBeCloseTo(60);
    expect(trace).toHaveLength(2);
    expect(trace[0]!.at(-1)!.x).toBe(30);
    expect(trace[1]![0]!.x).toBe(100);
    expect(trace[1]!.at(-1)!.x).toBeCloseTo(115);
  });

  for (const [name, word] of Object.entries(HANDWRITING)) {
    test(`${name} stays continuous through completion with no final shape swap`, () => {
      expect(traceHandwriting(word, 1)).toEqual(word.strokes.map(stroke => stroke.points));
      const before = traceHandwriting(word, 1 - 1e-6);
      const after = traceHandwriting(word, 1);
      expect(before).toHaveLength(after.length);
      const penBefore = before.at(-1)!.at(-1)!;
      const penAfter = after.at(-1)!.at(-1)!;
      expect(Math.hypot(penBefore.x - penAfter.x, penBefore.y - penAfter.y)).toBeLessThan(0.01);
      let previous = 0;
      for (let progress = 0.01; progress <= 1; progress += 0.01) {
        const count = traceHandwriting(word, progress).reduce((sum, stroke) => sum + stroke.length, 0);
        expect(count).toBeGreaterThanOrEqual(previous);
        previous = count;
      }
      for (const stroke of word.strokes) for (const point of stroke.points) {
        expect(point.x - word.pen / 2).toBeGreaterThanOrEqual(word.bounds.x - 1e-8);
        expect(point.y - word.pen / 2).toBeGreaterThanOrEqual(word.bounds.y - 1e-8);
        expect(point.x + word.pen / 2).toBeLessThanOrEqual(word.bounds.x + word.bounds.width + 1e-8);
        expect(point.y + word.pen / 2).toBeLessThanOrEqual(word.bounds.y + word.bounds.height + 1e-8);
      }
    });
  }
});
