import type { BuiltinCatalogEntry, BuiltinField } from '../../connectors/types';
import type { ConnectorView } from '../lib/types';

export type CatalogProvider = BuiltinCatalogEntry;
export type CatalogField = BuiltinField;
export type AuthFlow = { draft: boolean; connectorId?: string };

/** A connector is usable when its required secrets exist, or when its sign-in flow has completed. */
export function providerConnected(provider: CatalogProvider | undefined, connector: ConnectorView | undefined): boolean {
  if (!provider || !connector) return false;
  if (provider.connect) {
    if (provider.connect.kind === 'qr') return connector.runtime?.state === 'connected';
    return provider.connect.credentials.every(key => connector.credentialsSet?.includes(key));
  }
  return provider.fields
    .filter(field => field.type === 'password' && field.required)
    .every(field => connector.credentialsSet?.includes(field.key));
}

export function fieldVisible(field: CatalogField, settings: Record<string, unknown>): boolean {
  return !field.visibleWhen || settings[field.visibleWhen.key] === field.visibleWhen.equals;
}
