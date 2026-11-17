import { expect, test } from 'bun:test';
import { randomId } from '../src/web/lib/random';

test('random ID prefixes stay random when crypto is unavailable or throws', () => {
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const originalRandom = Math.random;
  const originalNow = Date.now;
  let sequence = 0;
  try {
    Math.random = () => (++sequence % 100) / 101;
    Date.now = () => 1234567890000;
    for (const crypto of [undefined, { randomUUID() { throw new Error('unavailable'); } }]) {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: crypto });
      const ids = Array.from({ length: 8 }, () => randomId());
      expect(new Set(ids.map(id => id.slice(0, 4))).size).toBe(8);
      expect(new Set(ids.map(id => id.slice(0, 8))).size).toBe(8);
    }
  } finally {
    Math.random = originalRandom;
    Date.now = originalNow;
    if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
    else Reflect.deleteProperty(globalThis, 'crypto');
  }
});
