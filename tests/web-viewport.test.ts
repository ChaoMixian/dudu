import { expect, test } from 'bun:test';
import { KEYBOARD_INSET, keyboardIsOpen } from '../src/web/lib/viewport';

test('keyboard detection ignores Safari toolbar changes and catches a real keyboard', () => {
  expect(keyboardIsOpen(800, 800)).toBe(false);
  expect(keyboardIsOpen(800, 800 - KEYBOARD_INSET)).toBe(false);
  expect(keyboardIsOpen(800, 800 - KEYBOARD_INSET - 1)).toBe(true);
  expect(keyboardIsOpen(800, 430)).toBe(true);
});
