import type { BotConfig, ProviderConfig } from '../../contracts';
import type { TFunction } from '../i18n';
import { randomId } from '../lib/random';

export const PROVIDER_APIS = ['openai-completions', 'openai-responses', 'anthropic-messages'] as const;
type ModelConfig = ProviderConfig['models'][number];
export interface ModelDraft {
  key: number;
  original?: ModelConfig;
  id: string;
  name: string;
  reasoning: boolean;
  contextWindow: string;
  maxTokens: string;
}
export interface ProviderDraft {
  id: string;
  name: string;
  api: ProviderConfig['api'];
  baseUrl: string;
  apiKey: string;
  models: ModelDraft[];
}

function randomSuffix(): string {
  return randomId().slice(0, 4);
}

function providerId(name: string): string {
  const base = name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'provider';
  return `${base}-${randomSuffix()}`;
}

export function newModelDraft(key: number, model?: ModelConfig): ModelDraft {
  return { key, original: model, id: model?.id ?? '', name: model?.name ?? '', reasoning: model?.reasoning ?? false,
    contextWindow: model?.contextWindow?.toString() ?? '', maxTokens: model?.maxTokens?.toString() ?? '' };
}

export function providerDraft(provider?: ProviderConfig): ProviderDraft {
  return {
    id: provider?.id ?? '', name: provider?.name ?? provider?.id ?? '', api: provider?.api ?? 'openai-completions', baseUrl: provider?.baseUrl ?? '',
    apiKey: provider?.apiKey ?? '',
    models: provider ? provider.models.map((model, key) => newModelDraft(key, model)) : [newModelDraft(0)],
  };
}

// Compare server records independently of object key order, including unknown fields.
export function providerFingerprint(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
}

export function providerConflict(providers: ProviderConfig[], original: ProviderConfig): boolean {
  return providerFingerprint(providers.find(provider => provider.id === original.id)) !== providerFingerprint(original);
}

export function buildProvider(draft: ProviderDraft, original: ProviderConfig | undefined, t: TFunction): ProviderConfig {
  const name = draft.name.trim();
  if (!name) throw new Error(t('providers.nameRequired'));
  const id = original?.id ?? (draft.id || providerId(name));
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id) || (original && id !== original.id)) throw new Error(t('providers.idRule'));
  try {
    if (!['http:', 'https:'].includes(new URL(draft.baseUrl.trim()).protocol)) throw new Error();
  } catch { throw new Error(t('providers.httpUrl')); }
  if (!PROVIDER_APIS.includes(draft.api)) throw new Error('Unsupported provider API');
  if (!draft.models.length || draft.models.some(model => !model.id.trim())) throw new Error(t('providers.modelRequired'));
  const ids = new Set<string>();
  const models = draft.models.map(row => {
    const id = row.id.trim();
    if (ids.has(id)) throw new Error(t('providers.duplicateModelId', { provider: name, id }));
    ids.add(id);
    const model: ModelConfig = { ...row.original, id, name: row.name.trim() || id };
    if (row.reasoning || row.original?.reasoning !== undefined) model.reasoning = row.reasoning;
    for (const field of ['contextWindow', 'maxTokens'] as const) {
      const input = row[field].trim();
      if (!input) delete model[field];
      else {
        const number = Number(input);
        if (!/^\d+$/.test(input) || !Number.isSafeInteger(number) || number <= 0) throw new Error(t('providers.positiveInteger'));
        model[field] = number;
      }
    }
    return model;
  });
  const provider: ProviderConfig = { ...original, id, name, api: draft.api, baseUrl: draft.baseUrl.trim(), models };
  delete provider.apiKey;
  if (draft.apiKey.trim()) provider.apiKey = draft.apiKey.trim();
  return provider;
}

export function providerReferences(bots: BotConfig[], providerId: string): BotConfig[] {
  return bots.filter(bot => bot.provider === providerId);
}

/** Merge only this target into the latest live list, never the list captured on dialog open. */
export function mergeProvider(providers: ProviderConfig[], original: ProviderConfig | undefined, replacement: ProviderConfig, t: TFunction): ProviderConfig[] {
  if (original) {
    if (providerConflict(providers, original)) throw new Error(t('providers.conflict'));
    return providers.map(provider => provider.id === original.id ? replacement : provider);
  }
  if (providers.some(provider => provider.id === replacement.id)) throw new Error(t('providers.duplicateId', { id: replacement.id }));
  return [...providers, replacement];
}

export function removeProvider(providers: ProviderConfig[], bots: BotConfig[], original: ProviderConfig, t: TFunction): ProviderConfig[] {
  if (providerConflict(providers, original)) throw new Error(t('providers.conflict'));
  if (providerReferences(bots, original.id).length) throw new Error(t('providers.removeBlocked'));
  return providers.filter(provider => provider.id !== original.id);
}
