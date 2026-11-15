import type { BotConfig, BotThread, ConnectorDefinition, DesktopStatus, MessageAttachment, MessageKind, ProviderConfig, SourceConfig } from '../../contracts';

export type BotState = 'idle' | 'running' | 'paused' | 'error';
export type MessageStatus = 'accepted' | 'sent' | 'failed';

export interface BotStatus { botId: string; state: BotState; pending: number; error?: string; activity?: { summary?: string; toolName?: string; startedAt: string } }
export interface Message {
  id: string; botId: string; conversationId: string; sender: string;
  text: string; kind: MessageKind; options?: string[]; targetId?: string; emoji?: string; replyTo?: string; attachments?: MessageAttachment[];
  status: MessageStatus; createdAt: string; seq: number;
}
export interface Defaults { provider?: string; model?: string }
export interface AppState {
  bots: BotConfig[]; connectors: ConnectorDefinition[]; sources: SourceConfig[];
  providers: ProviderConfig[]; defaults: Defaults; autoStartComputers: boolean;
  statuses: BotStatus[]; messages: Message[]; botThreads: BotThread[]; desktops: DesktopStatus[];
}
export const EMPTY_STATE: AppState = { bots: [], connectors: [], sources: [], providers: [], defaults: {}, autoStartComputers: true, statuses: [], messages: [], botThreads: [], desktops: [] };
