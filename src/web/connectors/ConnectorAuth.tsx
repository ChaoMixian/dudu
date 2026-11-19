import OutlookConnect from './OutlookConnect';
import WeixinConnect from './WeixinConnect';
import type { AuthFlow, CatalogProvider } from './model';

export default function ConnectorAuth({ provider, flow, settings, onBack, onConnected }: {
  provider: CatalogProvider;
  flow: AuthFlow;
  settings: Record<string, unknown>;
  onBack: () => void;
  onConnected: (credentials?: Record<string, string>) => void | Promise<void>;
}) {
  if (provider.connect?.kind === 'qr') return <WeixinConnect draft={flow.draft} connectorId={flow.connectorId} onBack={onBack} onConnected={onConnected} />;
  if (provider.connect?.kind === 'device-code') return <OutlookConnect draft={flow.draft} connectorId={flow.connectorId} settings={settings} onBack={onBack} onConnected={onConnected} />;
  return null;
}
