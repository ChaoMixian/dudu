import { describe, expect, test } from 'bun:test';
import type { BotConfig, ProviderConfig } from '../src/contracts';
import type { TFunction } from '../src/web/i18n';
import { buildProvider, mergeProvider, newModelDraft, providerConflict, providerDraft, providerFingerprint, providerReferences, removeProvider } from '../src/web/pages/provider-forms';

const t: TFunction = (key, params) => `${key}${params ? ` ${JSON.stringify(params)}` : ''}`;
const provider: ProviderConfig = {
  id: 'main', name: 'Main', api: 'openai-completions', baseUrl: 'https://example.com/v1', apiKey: 'sk-plaintext',
  models: [{ id: 'model-a', name: 'Model A' }],
};
const bot: BotConfig = { id: 'bot-a', name: 'Bot A', description: '', paused: false, bindings: [], provider: 'main' };
const clone = <T>(value: T): T => structuredClone(value);

function expectInvalid(patch: Partial<ReturnType<typeof providerDraft>>, message: string) {
  expect(() => buildProvider({ ...providerDraft(provider), ...patch }, undefined, t)).toThrow(message);
}

describe('graphical provider forms', () => {
  test('creates an empty graphical draft with one model row', () => {
    const draft = providerDraft();
    expect(draft.id).toBe('');
    expect(draft.apiKey).toBe('');
    expect(draft.models).toHaveLength(1);
    expect(newModelDraft(42).key).toBe(42);
  });

  test('untouched existing values round-trip, including unknown provider/model fields', () => {
    const original = { ...clone(provider), custom: { headers: { example: 'kept' } }, models: [{ ...provider.models[0], pricing: { input: 0.5 } }] };
    expect(buildProvider(providerDraft(original), original, t)).toEqual(original);
    expect(original.models[0]).not.toHaveProperty('reasoning');
  });

  test('stores the API key as plaintext and can clear it', () => {
    const draft = providerDraft(provider);
    expect(draft.apiKey).toBe('sk-plaintext');
    const updated = buildProvider({ ...draft, apiKey: ' sk-updated ' }, provider, t);
    expect(updated.apiKey).toBe('sk-updated');
    expect(updated).not.toHaveProperty('apiKeyEnv');
    expect(updated).not.toHaveProperty('apiKeyFile');
    const cleared = buildProvider({ ...providerDraft(updated), apiKey: '' }, updated, t);
    expect(cleared).not.toHaveProperty('apiKey');
    expect(providerDraft(cleared).apiKey).toBe('');
  });

  test('rejects invalid IDs, HTTP URLs, and attempts to change an existing ID', () => {
    for (const id of ['-bad', 'a/b', 'with space', 'x'.repeat(65)]) expectInvalid({ id }, 'providers.idRule');
    for (const baseUrl of ['', 'example.com', 'file:///tmp/key', 'javascript:alert(1)']) expectInvalid({ baseUrl }, 'providers.httpUrl');
    expect(buildProvider({ ...providerDraft(provider), id: 'other' }, provider, t).id).toBe('main');
    expect(buildProvider({ ...providerDraft(provider), id: '', name: 'New provider' }, undefined, t).id).toMatch(/^new-provider-[a-z0-9]{4}$/);
    expect(buildProvider({ ...providerDraft(provider), baseUrl: ' http://localhost:1234/v1 ' }, provider, t).baseUrl).toBe('http://localhost:1234/v1');
  });

  test('requires model IDs, defaults display names, and detects duplicates after trimming', () => {
    expectInvalid({ models: [] }, 'providers.modelRequired');
    expectInvalid({ models: [newModelDraft(0)] }, 'providers.modelRequired');
    const draft = providerDraft(provider);
    expectInvalid({ models: [draft.models[0], { ...draft.models[0], key: 1, id: ' model-a ' }] }, 'providers.duplicateModelId');
    expect(buildProvider({ ...draft, models: [{ ...draft.models[0], name: '  ' }] }, provider, t).models[0].name).toBe('model-a');
  });

  test('validates optional positive integers and preserves optional reasoning semantics', () => {
    const draft = providerDraft(provider);
    for (const input of ['0', '-1', '1.5', 'no', 'Infinity', '9007199254740992']) {
      expectInvalid({ models: [{ ...draft.models[0], contextWindow: input }] }, 'providers.positiveInteger');
      expectInvalid({ models: [{ ...draft.models[0], maxTokens: input }] }, 'providers.positiveInteger');
    }
    const result = buildProvider({ ...draft, models: [{ ...draft.models[0], contextWindow: ' 128000 ', maxTokens: '4096', reasoning: true }] }, provider, t);
    expect(result.models[0]).toMatchObject({ contextWindow: 128000, maxTokens: 4096, reasoning: true });
    const cleared = buildProvider({ ...providerDraft(result), models: [{ ...providerDraft(result).models[0], contextWindow: '', maxTokens: '', reasoning: false }] }, result, t);
    expect(cleared.models[0]).toEqual({ id: 'model-a', name: 'Model A', reasoning: false });
  });

  test('editing or deleting rows retains unknown fields for surviving original models only', () => {
    const original = { ...provider, models: [{ id: 'first', name: 'First', extra: 'keep' }, { id: 'second', name: 'Second', extra: 'remove' }] };
    const draft = providerDraft(original);
    const result = buildProvider({ ...draft, models: [{ ...draft.models[0], name: 'Updated' }, { ...newModelDraft(2), id: 'new', name: 'New' }] }, original, t);
    const expected = [{ id: 'first', name: 'Updated', extra: 'keep' }, { id: 'new', name: 'New' }];
    expect(result.models).toEqual(expected);
    expect(original.models[0].name).toBe('First');
  });

  test('fingerprints ignore object key order but include all unknown fields', () => {
    expect(providerFingerprint({ a: 1, b: { x: 2, y: 3 } })).toBe(providerFingerprint({ b: { y: 3, x: 2 }, a: 1 }));
    expect(providerFingerprint({ a: 1, custom: true })).not.toBe(providerFingerprint({ a: 1 }));
    expect(providerFingerprint(providerDraft(provider))).not.toBe(providerFingerprint({ ...providerDraft(provider), baseUrl: 'https://changed.example' }));
  });

  test('merges edits into the current list, retaining unrelated additions/changes and unknown fields', () => {
    const other = { ...clone(provider), id: 'other', custom: 'externally changed' };
    const added = { ...clone(provider), id: 'new-external' };
    const current = [other, clone(provider), added];
    const replacement = { ...provider, baseUrl: 'https://updated.example/v1' };
    const next = mergeProvider(current, provider, replacement, t);
    expect(next).toEqual([other, replacement, added]);
    expect(next[0]).toBe(other);
    expect(next[2]).toBe(added);
    expect(current[1].baseUrl).toBe(provider.baseUrl);
  });

  test('blocks edited target changes and deletion, even if only an unknown field changed', () => {
    for (const current of [[], [{ ...provider, baseUrl: 'https://elsewhere.example' }], [{ ...provider, unknown: true }]]) {
      expect(providerConflict(current, provider)).toBe(true);
      expect(() => mergeProvider(current, provider, provider, t)).toThrow('providers.conflict');
      expect(() => removeProvider(current, [], provider, t)).toThrow('providers.conflict');
    }
    expect(providerConflict([clone(provider)], provider)).toBe(false);
  });

  test('creating merges with the latest list but rejects an ID added elsewhere', () => {
    const created = { ...clone(provider), id: 'created' };
    expect(mergeProvider([provider], undefined, created, t)).toEqual([provider, created]);
    expect(() => mergeProvider([provider, created], undefined, created, t)).toThrow('providers.duplicateId');
  });

  test('deletion blocks every referencing bot, including paused bots, and preserves other providers', () => {
    const otherBot = { ...bot, id: 'bot-b', provider: 'other' };
    const pausedBot = { ...bot, id: 'paused', paused: true };
    expect(providerReferences([bot, otherBot, pausedBot], provider.id)).toEqual([bot, pausedBot]);
    expect(() => removeProvider([provider], [pausedBot], provider, t)).toThrow('providers.removeBlocked');
    const other = { ...provider, id: 'other', custom: 'preserved' };
    const result = removeProvider([provider, other], [otherBot], provider, t);
    expect(result).toEqual([other]);
    expect(result[0]).toBe(other);
  });
});
