import { describe, expect, test } from 'bun:test';
import type { ConnectorView } from '../src/web/lib/types';
import { fieldVisible, providerConnected, type CatalogProvider } from '../src/web/connectors/model';

function provider(connect?: CatalogProvider['connect'], fields: CatalogProvider['fields'] = []): CatalogProvider {
  return { id: 'test', name: 'Test', description: '', category: 'utility', fields, tools: [], ...(connect ? { connect } : {}) };
}

function connector(extra: Partial<ConnectorView> = {}): ConnectorView {
  return { id: 'test-1', name: 'Test', description: '', transport: 'builtin', provider: 'test', tools: [], ...extra };
}

describe('connector connection state', () => {
  test('QR sign-in follows the runtime state, not saved credentials alone', () => {
    const value = provider({ kind: 'qr', credentials: ['token'] });
    expect(providerConnected(value, connector({ credentialsSet: ['token'] }))).toBe(false);
    expect(providerConnected(value, connector({ credentialsSet: ['token'], runtime: { state: 'connected' } }))).toBe(true);
  });

  test('device-code sign-in requires every declared credential', () => {
    const value = provider({ kind: 'device-code', credentials: ['refreshToken'] });
    expect(providerConnected(value, connector())).toBe(false);
    expect(providerConnected(value, connector({ credentialsSet: ['accessToken'] }))).toBe(false);
    expect(providerConnected(value, connector({ credentialsSet: ['accessToken', 'refreshToken'] }))).toBe(true);
  });

  test('field-based connectors only require their required password fields', () => {
    const value = provider(undefined, [
      { key: 'endpoint', type: 'url', label: 'Endpoint' },
      { key: 'password', type: 'password', label: 'Password', required: true },
      { key: 'optional', type: 'password', label: 'Optional' },
    ]);
    expect(providerConnected(value, connector())).toBe(false);
    expect(providerConnected(value, connector({ credentialsSet: ['password'] }))).toBe(true);
  });

  test('conditional fields stay hidden until their setting matches', () => {
    const field = { key: 'serverUrl', type: 'url' as const, label: 'Server', visibleWhen: { key: 'preset', equals: 'custom' } };
    expect(fieldVisible(field, { preset: 'icloud' })).toBe(false);
    expect(fieldVisible(field, { preset: 'custom' })).toBe(true);
    expect(fieldVisible({ key: 'name', type: 'text' as const, label: 'Name' }, {})).toBe(true);
  });
});
