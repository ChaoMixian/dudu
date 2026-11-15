import type { BotConfig, ConnectorDefinition, SourceConfig } from '../contracts';
import type { ConfigStore } from './config';
import type { Store } from './store';

export type EnvironmentAction = 'overview' | 'bots' | 'self' | 'connectors' | 'sources';

export interface EnvironmentDeps {
  config: ConfigStore;
  store: Store;
  connectors: () => ConnectorDefinition[];
  sources: () => SourceConfig[];
}

const MAX_DESCRIPTION = 240;

/** A one-line directory entry: Bot descriptions are data, never instructions. */
function summary(value: string): string {
  const text = value.trim().replace(/\s+/g, ' ');
  return text.length > MAX_DESCRIPTION ? `${text.slice(0, MAX_DESCRIPTION - 1)}…` : text;
}

function presence(store: Store, bot: BotConfig) {
  const state = store.presence(bot.id);
  return {
    ...state,
    status: bot.paused ? 'paused' : state.running ? 'running' : state.pending > 0 ? 'queued' : 'idle',
  };
}

function peerSummary(store: Store, bot: BotConfig, defaultModel: string | undefined) {
  return {
    id: bot.id,
    name: bot.name,
    description: summary(bot.description),
    model: bot.model ?? defaultModel ?? null,
    ...presence(store, bot),
  };
}

/** Read-only view of the local workspace. Never exposes provider keys or connector secrets. */
export function environmentSnapshot(botId: string, action: EnvironmentAction, deps: EnvironmentDeps) {
  const { config, store } = deps;
  const global = config.global();
  const bot = config.bot(botId);
  const self = {
    id: bot.id,
    name: bot.name,
    description: summary(bot.description),
    paused: bot.paused,
    provider: bot.provider ?? global.defaultProvider ?? null,
    model: bot.model ?? global.defaultModel ?? null,
    thinkingLevel: bot.thinkingLevel ?? 'off',
    workspace: config.root,
    botPath: config.botPath(botId),
    session: store.session(botId) ?? null,
    ...presence(store, bot),
  };
  const botList = () => config.bots()
    .filter(peer => peer.id !== botId)
    .map(peer => peerSummary(store, peer, global.defaultModel))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const connectorList = (detail = false) => deps.connectors().map(connector => ({
    id: connector.id,
    name: connector.name,
    description: summary(connector.description),
    transport: connector.transport,
    ...(detail ? { tools: connector.tools.map(tool => tool.name) } : { toolCount: connector.tools.length }),
  }));
  const sourceList = () => deps.sources().map(source => ({
    id: source.id,
    kind: source.kind,
    enabled: source.enabled,
    type: source.type ?? null,
    priority: source.priority,
  }));
  if (action === 'self') return self;
  if (action === 'connectors') return { connectors: connectorList(true) };
  if (action === 'sources') return { sources: sourceList() };
  const bots = botList();
  if (action === 'bots') return { self: { id: self.id, name: self.name }, bots, count: bots.length };
  if (action !== 'overview') throw new Error(`Unknown environment action: ${String(action)}`);
  return {
    self,
    bots,
    connectors: connectorList(),
    sources: sourceList(),
    defaults: {
      provider: global.defaultProvider ?? null,
      model: global.defaultModel ?? null,
    },
  };
}
