import { Button } from '@heroui/react';
import { LogIn, LogOut } from 'lucide-react';
import type { ConnectorView } from '../lib/types';
import { useI18n } from '../i18n';
import { providerConnected, type CatalogProvider } from './model';

export default function ConnectionSection({ provider, connector, dirty, busy, onConnect, onDisconnect }: {
  provider: CatalogProvider;
  connector: ConnectorView;
  dirty: boolean;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const { t } = useI18n();
  if (!provider.connect) return null;
  const connected = providerConnected(provider, connector);
  const connectLabel = provider.connect.kind === 'qr' ? t('connectors.startScan') : t('connectors.outlookConnect');
  return <section className="flex flex-col gap-3 rounded-xl border border-separator bg-background/40 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{t('connectors.connection')}</p>
        <p className={`mt-1 flex items-center gap-1.5 text-xs ${connected ? 'text-success' : 'text-muted'}`}><span className={`size-1.5 rounded-full ${connected ? 'bg-success' : 'bg-foreground/20'}`} />{connected ? t('connectors.connected') : t('connectors.notConnected')}</p>
        {dirty && <p className="mt-1 text-[11px] text-muted">{t('connectors.saveBeforeConnect')}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" isDisabled={busy || dirty} onPress={onConnect}><LogIn size={14} />{connected ? t('connectors.reconnect') : connectLabel}</Button>
        {connected && <Button size="sm" variant="ghost" isDisabled={busy} onPress={onDisconnect}><LogOut size={14} />{t('connectors.disconnect')}</Button>}
      </div>
    </div>
  </section>;
}
