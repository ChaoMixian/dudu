import type { BotConfig, BotThread, ConnectorDefinition, DesktopStatus, MessageAttachment, MessageKind, ProviderConfig, SourceConfig, UserProfile } from '../../contracts';

export type BotState = 'idle' | 'running' | 'paused' | 'error';
export type MessageStatus = 'accepted' | 'sent' | 'failed';
export type SideTab = 'files' | 'terminal' | 'session' | 'computer';
export type PanelKind = 'start' | SideTab;
export interface PanelTab { id: string; kind: PanelKind; createdAt: number; terminalPid?: number }

export interface BotStatus { botId: string; state: BotState; pending: number; error?: string; activity?: { summary?: string; toolName?: string; startedAt: string } }
export interface Message {
  id: string; botId: string; conversationId: string; sender: string;
  text: string; kind: MessageKind; options?: string[]; targetId?: string; emoji?: string; replyTo?: string; attachments?: MessageAttachment[];
  status: MessageStatus; createdAt: string; seq: number;
}
export interface MessagePage { messages: Message[]; references: Message[]; cursor: number | null }
export interface Defaults { provider?: string; model?: string }
export interface AppState {
  bots: BotConfig[]; connectors: ConnectorDefinition[]; sources: SourceConfig[];
  providers: ProviderConfig[]; defaults: Defaults; autoStartComputers: boolean; advancedMode: boolean; setupCompleted: boolean;
  profile: UserProfile;
  messageCursors?: Record<string, number | null>; messageReferences?: Message[];
  statuses: BotStatus[]; messages: Message[]; botThreads: BotThread[]; desktops: DesktopStatus[];
}
export const EMPTY_STATE: AppState = { bots: [], connectors: [], sources: [], providers: [], defaults: {}, autoStartComputers: true, advancedMode: false, setupCompleted: false, profile: {}, statuses: [], messages: [], botThreads: [], desktops: [] };
