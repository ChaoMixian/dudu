import type { ConnectorTool } from '../contracts';

export type BuiltinFieldType = 'text' | 'password' | 'url' | 'select' | 'bot' | 'number' | 'checkbox';

export interface BuiltinFieldOption { value: string; label: string }

export interface BuiltinField {
  key: string;
  label: string;
  labelEn?: string;
  type: BuiltinFieldType;
  required?: boolean;
  placeholder?: string;
  help?: string;
  helpEn?: string;
  options?: BuiltinFieldOption[];
  defaultValue?: string | number | boolean;
  /** Show this field only when another setting has the given value. */
  visibleWhen?: { key: string; equals: string | number | boolean };
}

export type BuiltinCategory = 'notify' | 'calendar' | 'message' | 'utility';

export interface BuiltinConnection {
  kind: 'qr' | 'device-code';
  /** Credential keys whose presence means the connector is connected. */
  credentials: string[];
}

export interface BuiltinProviderContext {
  connectorId: string;
  settings: Record<string, unknown>;
  credentials: Record<string, string>;
  /** Persist refreshed OAuth credentials after a provider rotates them. */
  updateCredentials?: (credentials: Record<string, string>) => void;
}

export interface BuiltinCallOptions { signal?: AbortSignal; timeoutMs?: number }

export interface BuiltinProvider {
  id: string;
  name: string;
  description: string;
  descriptionEn?: string;
  category: BuiltinCategory;
  fields: BuiltinField[];
  tools: ConnectorTool[];
  /** Sign-in flow shown separately from editing connector settings. */
  connect?: BuiltinConnection;
  /** Validate and normalize persisted settings/credentials. Throws with an actionable message. */
  normalize(settings: Record<string, unknown>, credentials: Record<string, string>): { settings: Record<string, unknown>; credentials: Record<string, string> };
  call(tool: string, args: Record<string, unknown>, ctx: BuiltinProviderContext, options: BuiltinCallOptions): Promise<unknown>;
  test?(ctx: BuiltinProviderContext, options: BuiltinCallOptions): Promise<unknown>;
  disconnect?(ctx: BuiltinProviderContext): Promise<void>;
}

export interface BuiltinCatalogEntry {
  id: string;
  name: string;
  description: string;
  descriptionEn?: string;
  category: BuiltinCategory;
  fields: BuiltinField[];
  tools: ConnectorTool[];
  connect?: BuiltinConnection;
}

export function catalogEntry(provider: BuiltinProvider): BuiltinCatalogEntry {
  return {
    id: provider.id,
    name: provider.name,
    description: provider.description,
    ...(provider.descriptionEn ? { descriptionEn: provider.descriptionEn } : {}),
    category: provider.category,
    fields: structuredClone(provider.fields),
    tools: structuredClone(provider.tools),
    ...(provider.connect ? { connect: structuredClone(provider.connect) } : {}),
  };
}

export function stringSetting(settings: Record<string, unknown>, key: string, label: string): string {
  const value = settings[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

export function optionalStringSetting(settings: Record<string, unknown>, key: string): string | undefined {
  const value = settings[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function stringCredential(credentials: Record<string, string>, key: string, label: string): string {
  const value = credentials[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}
