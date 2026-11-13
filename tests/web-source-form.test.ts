import { describe, expect, test } from 'bun:test';
import { emptySourceDraft, localDateToIso, sourceFromDraft, SourceDraftError, type SourceDraft, type SourceDraftIssue } from '../src/web/lib/source-form';

const draft = (changes: Partial<SourceDraft> = {}): SourceDraft => ({ ...emptySourceDraft(), id: 'daily-check', botId: 'bot', task: 'Check todos', ...changes });
const convert = (changes: Partial<SourceDraft> = {}, existing: string[] = []) => sourceFromDraft(draft(changes), ['bot'], existing);
function rejects(changes: Partial<SourceDraft>, issue: SourceDraftIssue, existing: string[] = []) {
  try { convert(changes, existing); throw new Error('Expected validation failure'); }
  catch (error) { expect(error).toBeInstanceOf(SourceDraftError); expect((error as SourceDraftError).issue).toBe(issue); }
}

describe('graphical automation form conversion (no server or browser)', () => {
  test('fresh drafts do not share mutable argument/environment arrays', () => {
    const first = emptySourceDraft();
    first.arguments.push('one'); first.env.push({ key: 'NAME', value: 'value' });
    expect(emptySourceDraft().arguments).toEqual([]);
    expect(emptySourceDraft().env).toEqual([]);
  });

  test('builds the existing contract with task payload, ownership and flags', () => {
    expect(convert({ task: '  Do this\nand that  ', priority: 'high', enabled: false })).toEqual({
      id: 'daily-check', botId: 'bot', kind: 'interval', priority: 'high', enabled: false,
      payload: { task: 'Do this\nand that' }, intervalMs: 3_600_000,
    });
  });

  test('rejects invalid identities, unknown bots, duplicates and empty tasks', () => {
    for (const value of ['', '../escape', '-start', 'x'.repeat(65), 'with spaces']) rejects({ id: value }, 'id');
    rejects({ botId: '' }, 'bot'); rejects({ botId: 'unknown' }, 'bot');
    rejects({}, 'duplicate', ['daily-check']);
    rejects({ task: ' \n ' }, 'task');
  });

  test('converts once from local calendar components to an ISO instant', () => {
    const at = '2030-02-03T14:05';
    const iso = localDateToIso(at);
    const local = new Date(iso);
    expect(iso).toMatch(/^2030-02-0[234]T.*Z$/);
    expect([local.getFullYear(), local.getMonth(), local.getDate(), local.getHours(), local.getMinutes()]).toEqual([2030, 1, 3, 14, 5]);
    expect(convert({ kind: 'once', at }).at).toBe(iso);
    for (const value of ['', 'not-a-date', '2030-02-30T14:05', '2030-13-01T14:05', '2030-02-03T24:05', '2030-02-03T14:05Z']) rejects({ kind: 'once', at: value }, 'once');
  });

  test('converts minute/hour/day units, supports fractions and rejects invalid intervals', () => {
    expect(convert({ intervalValue: '2.5', intervalUnit: 'minutes' }).intervalMs).toBe(150_000);
    expect(convert({ intervalValue: '2', intervalUnit: 'hours' }).intervalMs).toBe(7_200_000);
    expect(convert({ intervalValue: '3', intervalUnit: 'days' }).intervalMs).toBe(259_200_000);
    for (const value of ['', ' ', '0', '-1', 'NaN', 'Infinity', '1e30', '0.0000001']) rejects({ intervalValue: value }, 'interval');
  });

  test('creates daily, weekday and weekly cron schedules with an explicit time zone', () => {
    expect(convert({ kind: 'cron', time: '09:05', timezone: 'Asia/Shanghai' })).toMatchObject({ cron: '5 9 * * *', timezone: 'Asia/Shanghai' });
    expect(convert({ kind: 'cron', schedule: 'weekdays', time: '17:30', timezone: 'UTC' }).cron).toBe('30 17 * * 1-5');
    expect(convert({ kind: 'cron', schedule: 'weekly', weekday: '0', time: '00:00' }).cron).toBe('0 0 * * 0');
    expect(convert({ kind: 'cron', schedule: 'weekly', weekday: '6', time: '23:59' }).cron).toBe('59 23 * * 6');
    rejects({ kind: 'cron', time: '24:00' }, 'cron');
    rejects({ kind: 'cron', time: '9:00' }, 'cron');
    rejects({ kind: 'cron', schedule: 'weekly', weekday: '7' }, 'cron');
    rejects({ kind: 'cron', timezone: '' }, 'timezone');
    rejects({ kind: 'cron', timezone: 'Not/AZone' }, 'timezone');
  });

  test('keeps process arguments separate and preserves empty/whitespace argument and env values', () => {
    expect(convert({ kind: 'process', executable: ' /usr/bin/tool ', arguments: ['two words', '', '$HOME', '--flag'], env: [{ key: ' NAME ', value: ' a=b ' }] })).toMatchObject({
      argv: ['/usr/bin/tool', 'two words', '', '$HOME', '--flag'], env: { NAME: ' a=b ' }, payload: { task: 'Check todos' },
    });
    expect(convert({ kind: 'process', executable: 'tool' }).env).toBeUndefined();
    rejects({ kind: 'process', executable: ' ' }, 'process');
    rejects({ kind: 'process', executable: 'tool\0bad' }, 'process');
    rejects({ kind: 'process', executable: 'tool', arguments: ['bad\0argument'] }, 'process');
    for (const env of [
      [{ key: '', value: 'x' }], [{ key: 'BAD=NAME', value: '' }], [{ key: '2NAME', value: '' }],
      [{ key: 'NAME', value: '' }, { key: ' NAME ', value: '' }], [{ key: 'NAME', value: '\0' }],
    ]) rejects({ kind: 'process', executable: 'tool', env }, 'env');
  });

  test('handles environment prototype keys as own data properties', () => {
    const source = convert({ kind: 'process', executable: 'tool', env: [{ key: '__proto__', value: 'literal' }] });
    expect(Object.hasOwn(source.env!, '__proto__')).toBe(true);
    expect(source.env!.__proto__).toBe('literal');
    expect(Object.getPrototypeOf(source.env!)).toBe(Object.prototype);
  });

  test('uses webhook event type without creating a callback URL', () => {
    const source = convert({ kind: 'webhook', eventType: ' external.changed ' });
    expect(source).toEqual({ id: 'daily-check', botId: 'bot', kind: 'webhook', priority: 'normal', enabled: true, payload: { task: 'Check todos' }, type: 'external.changed' });
    rejects({ kind: 'webhook', eventType: '' }, 'type');
    rejects({ kind: 'webhook', eventType: 'bad\0type' }, 'type');
  });

  test('hidden fields survive switching kinds without leaking unrelated fields into the request', () => {
    const source = convert({ kind: 'once', at: '2030-02-03T14:05', executable: 'tool', arguments: ['--x'], env: [{ key: '', value: '' }], time: 'invalid', timezone: 'invalid' });
    expect(source.kind).toBe('once');
    for (const field of ['argv', 'env', 'cron', 'timezone', 'intervalMs', 'type']) expect(Object.hasOwn(source, field)).toBe(false);
  });
});
